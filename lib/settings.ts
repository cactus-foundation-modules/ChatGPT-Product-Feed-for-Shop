// The settings row: read, written, and the feed key minted and replaced.
import { randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import {
  BLANK_SETTINGS,
  asCondition,
  asHttpUrl,
  asReturnWindow,
  textOrNull,
  type Condition,
  type CpfSettings,
} from '@/modules/chatgpt-product-feed-for-shop/lib/types'

type SettingsRow = {
  enabled: boolean
  feed_token: string | null
  seller_name: string | null
  default_brand: string | null
  brand_from_supplier: boolean
  mpn_from_sku: boolean
  default_condition: string
  include_out_of_stock: boolean
  accepts_returns: boolean | null
  return_window_days: number | null
  return_policy_url: string | null
  ads_eligible: boolean
  last_fetched_at: Date | null
  last_fetched_items: number | null
  last_fetch_agent: string | null
}

// 24 url-safe characters: unguessable, and still short enough to read out.
function mintToken(): string {
  return randomBytes(18).toString('base64url')
}

/** The settings row, minting the feed key on first read so an address exists
 *  the moment the tab is opened. The mint is guarded on NULL, so two first
 *  reads at once cannot each install a key of their own. */
export async function getCpfSettings(): Promise<CpfSettings> {
  const rows = await prisma.$queryRaw<SettingsRow[]>`
    SELECT "enabled", "feed_token", "seller_name", "default_brand", "brand_from_supplier", "mpn_from_sku",
           "default_condition", "include_out_of_stock", "accepts_returns", "return_window_days",
           "return_policy_url", "ads_eligible", "last_fetched_at", "last_fetched_items", "last_fetch_agent"
    FROM "cpf_settings" WHERE "id" = 'singleton'
  `.catch(() => [] as SettingsRow[])
  const row = rows[0]
  // No row means the migration has not run: serve nothing rather than guess.
  if (!row) return BLANK_SETTINGS

  let feedToken = row.feed_token
  if (!feedToken) {
    const fresh = mintToken()
    await prisma.$executeRaw`
      UPDATE "cpf_settings" SET "feed_token" = ${fresh}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = 'singleton' AND "feed_token" IS NULL
    `
    // Re-read rather than trust our own value: on a tie the other writer won.
    const check = await prisma.$queryRaw<Array<{ feed_token: string | null }>>`
      SELECT "feed_token" FROM "cpf_settings" WHERE "id" = 'singleton'
    `
    feedToken = check[0]?.feed_token ?? fresh
  }

  return {
    enabled: row.enabled,
    feedToken,
    sellerName: row.seller_name,
    defaultBrand: row.default_brand,
    brandFromSupplier: row.brand_from_supplier,
    mpnFromSku: row.mpn_from_sku,
    defaultCondition: asCondition(row.default_condition),
    includeOutOfStock: row.include_out_of_stock,
    acceptsReturns: row.accepts_returns,
    returnWindowDays: row.return_window_days,
    returnPolicyUrl: row.return_policy_url,
    adsEligible: row.ads_eligible,
    lastFetchedAt: row.last_fetched_at ? row.last_fetched_at.toISOString() : null,
    lastFetchedItems: row.last_fetched_items,
    lastFetchAgent: row.last_fetch_agent,
  }
}

export type CpfSettingsPatch = {
  enabled?: boolean
  sellerName?: string | null
  defaultBrand?: string | null
  brandFromSupplier?: boolean
  mpnFromSku?: boolean
  defaultCondition?: Condition
  includeOutOfStock?: boolean
  acceptsReturns?: boolean | null
  returnWindowDays?: number | string | null
  returnPolicyUrl?: string | null
  adsEligible?: boolean
}

/** Writes whichever fields the patch carries, normalised, in one statement. */
export async function updateCpfSettings(patch: CpfSettingsPatch): Promise<void> {
  const sets: Prisma.Sql[] = []
  if (patch.enabled !== undefined) sets.push(Prisma.sql`"enabled" = ${patch.enabled}`)
  if (patch.sellerName !== undefined) sets.push(Prisma.sql`"seller_name" = ${textOrNull(patch.sellerName)}`)
  if (patch.defaultBrand !== undefined) sets.push(Prisma.sql`"default_brand" = ${textOrNull(patch.defaultBrand)}`)
  if (patch.brandFromSupplier !== undefined) sets.push(Prisma.sql`"brand_from_supplier" = ${patch.brandFromSupplier}`)
  if (patch.mpnFromSku !== undefined) sets.push(Prisma.sql`"mpn_from_sku" = ${patch.mpnFromSku}`)
  if (patch.defaultCondition !== undefined) sets.push(Prisma.sql`"default_condition" = ${asCondition(patch.defaultCondition)}`)
  if (patch.includeOutOfStock !== undefined) sets.push(Prisma.sql`"include_out_of_stock" = ${patch.includeOutOfStock}`)
  if (patch.acceptsReturns !== undefined) sets.push(Prisma.sql`"accepts_returns" = ${patch.acceptsReturns}`)
  if (patch.returnWindowDays !== undefined) sets.push(Prisma.sql`"return_window_days" = ${asReturnWindow(patch.returnWindowDays)}`)
  if (patch.returnPolicyUrl !== undefined) sets.push(Prisma.sql`"return_policy_url" = ${asHttpUrl(patch.returnPolicyUrl)}`)
  if (patch.adsEligible !== undefined) sets.push(Prisma.sql`"ads_eligible" = ${patch.adsEligible}`)
  if (sets.length === 0) return
  await prisma.$executeRaw`
    UPDATE "cpf_settings" SET ${Prisma.join(sets, ', ')}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'
  `
}

/** Replaces the feed key, cutting the old address off at once. */
export async function regenerateCpfFeedToken(): Promise<string> {
  const fresh = mintToken()
  await prisma.$executeRaw`
    UPDATE "cpf_settings" SET "feed_token" = ${fresh}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'
  `
  return fresh
}

/** Notes a successful collection of the feed. The agent is whatever the fetcher
 *  calls itself, capped, because it is shown back to the owner and nothing more. */
export async function recordFeedFetch(items: number, agent: string | null): Promise<void> {
  const label = agent ? agent.slice(0, 200) : null
  await prisma.$executeRaw`
    UPDATE "cpf_settings"
    SET "last_fetched_at" = CURRENT_TIMESTAMP, "last_fetched_items" = ${items}, "last_fetch_agent" = ${label}
    WHERE "id" = 'singleton'
  `
}
