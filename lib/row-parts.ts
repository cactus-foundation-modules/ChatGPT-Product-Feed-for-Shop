// The small judgement calls a feed row is made of, each pure so it can be
// tested without a catalogue. lib/feed-data.ts gathers the inputs; these decide.
import type { Availability } from '@/modules/chatgpt-product-feed-for-shop/lib/feed-format'

/** Stock as OpenAI names it. Pre-order outranks stock: the shop takes the order
 *  either way. A shop that does not count stock is always in stock. */
export function availabilityOf(row: {
  trackInventory: boolean
  stockCount: number | null
  outOfStockBehaviour: string
  isPreOrder: boolean
}): Availability {
  if (row.isPreOrder) return 'pre_order'
  if (!row.trackInventory || (row.stockCount ?? 0) > 0) return 'in_stock'
  return row.outOfStockBehaviour === 'BACKORDER' ? 'backorder' : 'out_of_stock'
}

/** Brand: the supplier the row is filed under (nearest row first, when the
 *  owner allows it), then the shop-wide default. Undefined means nobody knows,
 *  and the row is held back rather than sent with a guess. */
export function brandOf(
  suppliers: ReadonlyArray<string | null | undefined>,
  opts: { brandFromSupplier: boolean; defaultBrand: string | null },
): string | undefined {
  const supplier = opts.brandFromSupplier ? suppliers.map((s) => s?.trim()).find((s) => !!s) : undefined
  return supplier || opts.defaultBrand?.trim() || undefined
}

/** A media URL made absolute. Storage normally hands back a full address, but a
 *  path served from the site itself arrives as `/media/...`, and the spec wants
 *  every image publicly fetchable on its own. */
export function absoluteUrl(url: string, siteUrl: string): string | undefined {
  const trimmed = url.trim()
  if (!trimmed) return undefined
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (trimmed.startsWith('/')) return `${siteUrl.replace(/\/+$/, '')}${trimmed}`
  return undefined
}

const WEIGHT_UNITS: Record<string, string> = { g: 'g', kg: 'kg', oz: 'oz', lb: 'lb', lbs: 'lb' }

/** Net weight and its unit, both or neither - the spec ignores a weight with no
 *  unit, so a half answer is not worth sending. */
export function weightOf(weight: number | string | null | undefined, unit: string | null | undefined): { weight: string; unit: string } | undefined {
  const value = weight == null || weight === '' ? NaN : Number(weight)
  if (!Number.isFinite(value) || value <= 0) return undefined
  const u = WEIGHT_UNITS[(unit ?? 'kg').toLowerCase()]
  if (!u) return undefined
  return { weight: String(value), unit: u }
}

/** Returns, as OpenAI asks them, from the shop-wide answer and this row's own.
 *
 *  A row the shop will not take back is `false` whatever the shop-wide answer,
 *  because that is the truth about this item. Otherwise the shop-wide answer
 *  stands, and the window only goes with a yes. Not stated stays not stated. */
export function returnsOf(
  rowReturnable: boolean,
  shop: { acceptsReturns: boolean | null; returnWindowDays: number | null },
): { accepts_returns?: boolean; return_deadline_in_days?: number } {
  if (!rowReturnable) return { accepts_returns: false }
  if (shop.acceptsReturns === true) {
    return { accepts_returns: true, ...(shop.returnWindowDays ? { return_deadline_in_days: shop.returnWindowDays } : {}) }
  }
  if (shop.acceptsReturns === false) return { accepts_returns: false }
  return {}
}

/** Category id -> "Root > Child > Leaf", built once per run. */
export function buildCategoryPaths(categories: ReadonlyArray<{ id: string; name: string; parentId: string | null }>): Map<string, string> {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const paths = new Map<string, string>()
  for (const category of categories) {
    const names: string[] = []
    let current: { id: string; name: string; parentId: string | null } | undefined = category
    // Depth guard: a cycle in parent ids must not hang the feed.
    for (let hops = 0; current && hops < 20; hops++) {
      names.unshift(current.name)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    paths.set(category.id, names.join(' > '))
  }
  return paths
}

/** The order an item's pictures are offered in: primary first, duplicates out. */
export function orderedImages(urls: readonly string[], siteUrl: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    const url = absoluteUrl(raw, siteUrl)
    if (!url) continue
    const key = url.split('#')[0]?.split('?')[0] ?? url
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }
  return out
}
