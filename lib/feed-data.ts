// Builds the feed's rows from the shop and shop-variations modules.
//
// One row per thing a shopper can buy: each enabled variation of a listing,
// grouped under its listing with group_id, and each product with no variations
// on its own. Reads go through the two modules' own lib functions wherever one
// exists, with raw SQL only for the child-product columns no bulk read carries.
// Prices, tax and stock come from the shop's own helpers, never re-derived: a
// feed that disagrees with the storefront about a price is the one mistake
// worth designing against.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { productUrl } from '@/modules/shop/lib/product-url'
import { listProducts, getProductMediaForProducts, HARD_MAX_PER_PAGE } from '@/modules/shop/lib/db/products'
import { listCategories } from '@/modules/shop/lib/db/catalogue'
import { getDefaultTaxZoneId, listTaxZoneRates } from '@/modules/shop/lib/db/tax-shipping'
import { displayAmount, type PriceDisplay } from '@/modules/shop/lib/tax-display-shared'
import { isOnSale } from '@/modules/shop/lib/pricing'
import { hidesOutOfStockFromShoppers, outOfStockSql } from '@/modules/shop/lib/stock-visibility'
import { resolveReturnable } from '@/modules/shop/lib/returnable'
import { stripHtmlToPlainText } from '@/modules/shop/lib/strip-html'
import type { ShpProduct } from '@/modules/shop/lib/types'
import { getProductIdsWithVariations } from '@/modules/shop-variations/lib/db/variants'
import { getEditorPayloadsBatch } from '@/modules/shop-variations/lib/variants-service'
import { variationCanonicalQuery } from '@/modules/shop-variations/lib/url-selection'
import { getCpfSettings } from '@/modules/chatgpt-product-feed-for-shop/lib/settings'
import type { CpfSettings } from '@/modules/chatgpt-product-feed-for-shop/lib/types'
import {
  DESCRIPTION_MAX,
  TITLE_MAX,
  clip,
  money,
  validGtin,
  type FeedRow,
} from '@/modules/chatgpt-product-feed-for-shop/lib/feed-format'
import {
  availabilityOf,
  brandOf,
  buildCategoryPaths,
  orderedImages,
  returnsOf,
  weightOf,
} from '@/modules/chatgpt-product-feed-for-shop/lib/row-parts'

type ParentRow = {
  id: string
  name: string
  slug: string
  price: unknown
  description: string | null
  short_description: string | null
  meta_description: string | null
  master_category_id: string | null
  tax_class_id: string | null
  supplier: string | null
  returnable: boolean | null
}

type ChildRow = {
  id: string
  slug: string
  status: string
  out_of_stock_behaviour: string
  is_pre_order: boolean
  tax_class_id: string | null
  weight_unit: string | null
}

export type WithheldReason = 'no-image' | 'no-brand' | 'no-price'
export type WithheldItem = { id: string; title: string; reason: WithheldReason }

export type FeedBuild = {
  rows: FeedRow[]
  withheld: WithheldItem[]
  /** The seller name every row carries, so the settings tab can show it. */
  sellerName: string
}

/** A row before the checks that can hold it back. */
type Candidate = Omit<FeedRow, 'brand' | 'image_url' | 'additional_image_urls'> & {
  brand: string | undefined
  images: string[]
  amount: number
}

function descriptionOf(row: { description?: string | null; short_description?: string | null; meta_description?: string | null }, fallback: string): string {
  // The fullest text first: an assistant answering questions about a product
  // wants the real description, not the one-line search snippet.
  for (const raw of [row.description, row.short_description, row.meta_description]) {
    const text = raw ? stripHtmlToPlainText(raw).trim() : ''
    if (text) return clip(text, DESCRIPTION_MAX)
  }
  return fallback
}

async function siteName(): Promise<string | null> {
  const config = await prisma.siteConfig
    .findUnique({ where: { id: 'singleton' }, select: { siteName: true } })
    .catch(() => null)
  return config?.siteName?.trim() || null
}

/** The seller name rows carry: the owner's own, else the site name. */
export async function effectiveSellerName(settings: Pick<CpfSettings, 'sellerName'>): Promise<string | null> {
  return settings.sellerName?.trim() || (await siteName())
}

/** Holds back what the spec would reject and finishes the rest. */
function finish(candidate: Candidate, withheld: WithheldItem[]): FeedRow | null {
  const { brand, images, amount, ...rest } = candidate
  if (!(amount > 0)) {
    withheld.push({ id: rest.item_id, title: rest.title, reason: 'no-price' })
    return null
  }
  const [image, ...more] = images
  if (!image) {
    withheld.push({ id: rest.item_id, title: rest.title, reason: 'no-image' })
    return null
  }
  if (!brand) {
    withheld.push({ id: rest.item_id, title: rest.title, reason: 'no-brand' })
    return null
  }
  return {
    ...rest,
    brand,
    image_url: image,
    ...(more.length > 0 ? { additional_image_urls: more } : {}),
  }
}

export async function buildFeed(siteUrl: string): Promise<FeedBuild> {
  const [config, settings] = await Promise.all([getShopConfigCached(), getCpfSettings()])
  const sellerName = (await effectiveSellerName(settings)) ?? ''
  const currency = config.currency
  const hideOutOfStock = hidesOutOfStockFromShoppers(config)

  // The price a shopper actually pays. Forced tax-inclusive whatever the
  // storefront prints, as every shopping channel wants; on a shop storing
  // gross prices that is a multiply-by-one.
  const display: PriceDisplay = { mode: 'INCLUSIVE', storedIncludesTax: config.taxMode === 'INCLUSIVE', suffix: '' }
  const rates = new Map<string, number>()
  if (!display.storedIncludesTax) {
    const zoneId = await getDefaultTaxZoneId()
    if (zoneId) {
      for (const rate of await listTaxZoneRates(zoneId)) {
        const value = Number(rate.rate)
        if (Number.isFinite(value)) rates.set(rate.taxClassId, value)
      }
    }
  }
  const gross = (amount: number, taxClassId: string | null): number =>
    Math.round(displayAmount(amount, display, taxClassId ? rates.get(taxClassId) ?? 0 : 0) * 100) / 100

  // ----- Listings with variations ------------------------------------------
  // Narrowed to what a shopper can see: active, not hidden, not a spare part,
  // physical, and - where the shop hides sold-out products - not sold out.
  const variationParentIds = await getProductIdsWithVariations()
  let parents: ParentRow[] = []
  if (variationParentIds.length > 0) {
    const stockFilter = hideOutOfStock ? Prisma.sql`AND NOT ${await outOfStockSql()}` : Prisma.empty
    parents = await prisma.$queryRaw<ParentRow[]>`
      SELECT p."id", p."name", p."slug", p."price", p."description", p."short_description",
             p."meta_description", p."master_category_id", p."tax_class_id", p."supplier", p."returnable"
      FROM "shp_products" p
      WHERE p."id" IN (${Prisma.join(variationParentIds)})
        AND p."status" = 'ACTIVE' AND p."catalogue_hidden" = false AND p."parts_only" = false AND p."type" = 'PHYSICAL'
        ${stockFilter}
    `
  }
  const payloads = await getEditorPayloadsBatch(parents.map((p) => ({
    id: p.id, name: p.name, slug: p.slug, price: Number(p.price), returnable: p.returnable,
  })))

  const childIds = [...payloads.values()].flatMap((p) => p.variants.filter((v) => v.enabled).map((v) => v.childProductId))
  const childById = new Map<string, ChildRow>()
  if (childIds.length > 0) {
    const rows = await prisma.$queryRaw<ChildRow[]>`
      SELECT "id", "slug", "status", "out_of_stock_behaviour", "is_pre_order", "tax_class_id", "weight_unit"
      FROM "shp_products" WHERE "id" IN (${Prisma.join(childIds)})
    `
    for (const row of rows) childById.set(row.id, row)
  }

  // ----- Products with no variations ---------------------------------------
  // listProducts applies the shop grid's own visibility rules. A listing known
  // to shop-variations with no enabled variation falls through to here.
  const variationParentSet = new Set(variationParentIds)
  const standalone: ShpProduct[] = []
  for (let page = 1; ; page++) {
    const { products, total } = await listProducts({
      status: 'ACTIVE',
      type: 'PHYSICAL',
      excludeHidden: true,
      storefront: true,
      page,
      perPage: HARD_MAX_PER_PAGE,
      maxPerPage: HARD_MAX_PER_PAGE,
    })
    for (const product of products) {
      const hasEnabledVariants = (payloads.get(product.id)?.variants ?? []).some((v) => v.enabled)
      if (variationParentSet.has(product.id) && hasEnabledVariants) continue
      standalone.push(product)
    }
    if (page * HARD_MAX_PER_PAGE >= total || products.length === 0) break
  }

  // ----- Shared lookups ----------------------------------------------------
  const parentIds = parents.map((p) => p.id)
  const standaloneIds = standalone.map((p) => p.id)
  const [mediaByProduct, categories] = await Promise.all([
    getProductMediaForProducts([...parentIds, ...standaloneIds]),
    listCategories(),
  ])
  const categoryPaths = buildCategoryPaths(categories)

  // Lead category: the master where set, else the first the product is filed in.
  const needFallback = [
    ...parents.filter((p) => !p.master_category_id).map((p) => p.id),
    ...standalone.filter((p) => !p.masterCategoryId).map((p) => p.id),
  ]
  const fallbackCategory = new Map<string, string>()
  if (needFallback.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ product_id: string; category_id: string }>>`
      SELECT DISTINCT ON ("product_id") "product_id", "category_id"
      FROM "shp_product_categories" WHERE "product_id" IN (${Prisma.join(needFallback)})
      ORDER BY "product_id"
    `
    for (const row of rows) fallbackCategory.set(row.product_id, row.category_id)
  }
  const categoryOf = (productId: string, master: string | null): string | undefined => {
    const id = master ?? fallbackCategory.get(productId)
    return id ? categoryPaths.get(id) : undefined
  }

  const imagesOf = (productId: string): string[] =>
    (mediaByProduct.get(productId) ?? [])
      .filter((m) => m.type === 'IMAGE')
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      .map((m) => m.url)

  const shared = {
    seller_name: sellerName,
    seller_url: siteUrl,
    condition: settings.defaultCondition,
    ...(settings.returnPolicyUrl ? { return_policy: settings.returnPolicyUrl } : {}),
    ...(settings.adsEligible ? { is_ads_eligible: true } : {}),
  }
  const keep = (availability: string) => settings.includeOutOfStock || availability !== 'out_of_stock'

  const rows: FeedRow[] = []
  const withheld: WithheldItem[] = []

  // ----- One row per enabled variation -------------------------------------
  for (const parent of parents) {
    const payload = payloads.get(parent.id)
    if (!payload) continue
    const parentImages = imagesOf(parent.id)
    const description = descriptionOf(parent, parent.name)
    const productCategory = categoryOf(parent.id, parent.master_category_id)

    for (const variant of payload.variants) {
      if (!variant.enabled) continue
      const child = childById.get(variant.childProductId)
      if (!child || child.status !== 'ACTIVE') continue

      const availability = availabilityOf({
        trackInventory: variant.trackInventory,
        stockCount: variant.stockCount,
        outOfStockBehaviour: child.out_of_stock_behaviour,
        isPreOrder: child.is_pre_order,
      })
      if (!keep(availability)) continue

      const variantDict: Record<string, string> = {}
      for (const option of payload.options) {
        const value = option.values.find((v) => variant.optionValueIds.includes(v.id))
        const name = option.name.trim()
        const label = value?.label.trim()
        if (name && label) variantDict[name] = label
      }

      // The address the sitemap and the canonical tag use for this combination
      // - the listing with its options selected - falling back to the
      // variation's own page where the combination has no address of its own.
      const query = variationCanonicalQuery(payload.options, variant.optionValueIds)
      const url = query
        ? `${productUrl(siteUrl, parent.slug, config.productUrlStyle)}?${query}`
        : productUrl(siteUrl, child.slug, config.productUrlStyle)

      const taxClassId = child.tax_class_id ?? parent.tax_class_id
      const price = gross(variant.price, taxClassId)
      const onSale = isOnSale({ price: variant.price, salePrice: variant.salePrice }, config.enabledPriceTypes)
      const sale = onSale && variant.salePrice != null ? gross(variant.salePrice, taxClassId) : null
      const weight = weightOf(variant.weight, child.weight_unit)
      const title = clip(variant.label ? `${parent.name} - ${variant.label}` : parent.name, TITLE_MAX)
      const gtin = validGtin(variant.barcode)
      const mpn = settings.mpnFromSku ? variant.sku?.trim() || undefined : undefined
      const hasOptions = Object.keys(variantDict).length > 0

      const row = finish({
        item_id: variant.childProductId,
        title,
        description,
        url,
        brand: brandOf([variant.supplier, parent.supplier], settings),
        images: orderedImages(variant.imageUrls.length > 0 ? variant.imageUrls : parentImages, siteUrl),
        availability,
        amount: price,
        price: money(price, currency),
        ...(sale != null && sale > 0 && sale < price ? { sale_price: money(sale, currency) } : {}),
        group_id: parent.id,
        ...(hasOptions ? { listing_has_variations: true, variant_dict: variantDict } : {}),
        ...(gtin ? { gtin } : {}),
        ...(mpn ? { mpn } : {}),
        ...(productCategory ? { product_category: productCategory } : {}),
        ...(weight ? { weight: weight.weight, item_weight_unit: weight.unit } : {}),
        ...returnsOf(resolveReturnable(variant.returnable, parent.returnable), settings),
        ...shared,
      }, withheld)
      if (row) rows.push(row)
    }
  }

  // ----- One row per product with no variations ----------------------------
  for (const product of standalone) {
    const availability = availabilityOf(product)
    if (!keep(availability)) continue
    const price = gross(Number(product.price), product.taxClassId)
    const onSale = isOnSale(product, config.enabledPriceTypes)
    const sale = onSale && product.salePrice != null ? gross(Number(product.salePrice), product.taxClassId) : null
    const weight = weightOf(product.weight, product.weightUnit)
    const gtin = validGtin(product.barcode)
    const mpn = settings.mpnFromSku ? product.sku?.trim() || undefined : undefined
    const productCategory = categoryOf(product.id, product.masterCategoryId)

    const row = finish({
      item_id: product.id,
      title: clip(product.name, TITLE_MAX),
      description: descriptionOf(
        { description: product.description, short_description: product.shortDescription, meta_description: product.metaDescription },
        product.name,
      ),
      url: productUrl(siteUrl, product.slug, config.productUrlStyle),
      brand: brandOf([product.supplier], settings),
      images: orderedImages(imagesOf(product.id), siteUrl),
      availability,
      amount: price,
      price: money(price, currency),
      ...(sale != null && sale > 0 && sale < price ? { sale_price: money(sale, currency) } : {}),
      ...(gtin ? { gtin } : {}),
      ...(mpn ? { mpn } : {}),
      ...(productCategory ? { product_category: productCategory } : {}),
      ...(weight ? { weight: weight.weight, item_weight_unit: weight.unit } : {}),
      ...returnsOf(resolveReturnable(null, product.returnable), settings),
      ...shared,
    }, withheld)
    if (row) rows.push(row)
  }

  return { rows, withheld, sellerName }
}
