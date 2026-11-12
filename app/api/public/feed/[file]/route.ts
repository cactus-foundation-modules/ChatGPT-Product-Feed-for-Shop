// GET /api/m/chatgpt-product-feed-for-shop/public/feed/<file>?key=<token>
//
// The product file for ChatGPT, built fresh from the shop on every fetch.
// <file> picks the format: products.csv (the default the settings tab hands
// out), products.tsv, products.jsonl, and a .gz of each, which is what OpenAI's
// file-upload spec prefers.
//
// Every wrong request is the same plain 404 - module switched off, wrong key,
// unknown file name, shop closed, prices hidden - so someone probing the
// address learns nothing about which it was.
import { gzipSync } from 'zlib'
import { getShopConfigCached } from '@/modules/shop/lib/config'
import { resolveShopCommerceMode } from '@/modules/shop/lib/commerce-mode'
import { getSiteUrlOrNull } from '@/lib/config/env'
import { getCpfSettings, recordFeedFetch } from '@/modules/chatgpt-product-feed-for-shop/lib/settings'
import { buildFeed } from '@/modules/chatgpt-product-feed-for-shop/lib/feed-data'
import { contentTypeOf, isFeedFile, renderFeed } from '@/modules/chatgpt-product-feed-for-shop/lib/feed-format'

const notFound = () => new Response('Not found', { status: 404 })

export async function GET(request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  if (!isFeedFile(file)) return notFound()

  const settings = await getCpfSettings()
  const key = new URL(request.url).searchParams.get('key')
  if (!settings.enabled || !settings.feedToken || key !== settings.feedToken) return notFound()

  const config = await getShopConfigCached()
  if (config.shopStatus === 'CLOSED') return notFound()

  // A quote-only shop withholds its prices everywhere, and price is required
  // on every row, so there is no honest feed to serve.
  const commerce = await resolveShopCommerceMode()
  if (commerce.hidePrices) return notFound()

  const siteUrl = getSiteUrlOrNull()
  if (!siteUrl) return notFound()

  const { rows, sellerName } = await buildFeed(siteUrl)
  // seller_name is required on every row; with none, every row would bounce.
  if (!sellerName) return notFound()

  const text = renderFeed(rows, file)
  const body = file.endsWith('.gz') ? gzipSync(Buffer.from(text, 'utf8')) : text

  // A note for the settings tab, never allowed to fail the fetch itself.
  await recordFeedFetch(rows.length, request.headers.get('user-agent')).catch((error) => {
    console.error('[chatgpt-product-feed] could not record the fetch:', error)
  })

  return new Response(body, {
    headers: {
      'Content-Type': contentTypeOf(file),
      'Content-Disposition': `inline; filename="${file}"`,
      // Holds a secret in its address and changes with every price edit:
      // nothing between here and the fetcher should keep a copy.
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
