// GET /api/m/chatgpt-product-feed-for-shop/admin/preview
//
// Builds the feed exactly as ChatGPT would receive it and reports on it: how
// many rows, which products were held back and why, and the first few rows.
// Works whether or not the feed is switched on, so the owner can check it
// before handing the address over.
import { NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getSiteUrlOrNull } from '@/lib/config/env'
import { resolveShopCommerceMode } from '@/modules/shop/lib/commerce-mode'
import { buildFeed } from '@/modules/chatgpt-product-feed-for-shop/lib/feed-data'

const SAMPLE_ROWS = 5
const WITHHELD_LISTED = 200

export async function GET() {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'shop.manage')) return errorResponse('Forbidden', 403)

  const siteUrl = getSiteUrlOrNull()
  if (!siteUrl) return errorResponse('This site has no address set, so there is nothing to link products to.', 409)
  const commerce = await resolveShopCommerceMode()
  if (commerce.hidePrices) {
    return errorResponse('The shop is hiding its prices, and ChatGPT needs a price on every product, so there is no feed to build.', 409)
  }

  const { rows, withheld, sellerName } = await buildFeed(siteUrl)
  const counts = { 'no-image': 0, 'no-brand': 0, 'no-price': 0 }
  for (const item of withheld) counts[item.reason]++

  return NextResponse.json({
    itemCount: rows.length,
    groupCount: new Set(rows.map((r) => r.group_id ?? r.item_id)).size,
    sellerName,
    withheldCount: withheld.length,
    withheldCounts: counts,
    withheld: withheld.slice(0, WITHHELD_LISTED),
    sample: rows.slice(0, SAMPLE_ROWS),
  })
}
