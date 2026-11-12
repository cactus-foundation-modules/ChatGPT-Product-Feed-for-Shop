// The feed's address, composed in one place. Pure.
//
// Served through core's module API dispatcher, which is public for a module's
// app/api/public/** routes. The file name sits on the end because some
// fetchers decide the format from the extension; the key is what guards it.
import type { FeedFile } from '@/modules/chatgpt-product-feed-for-shop/lib/feed-format'

export const MODULE_NAME = 'chatgpt-product-feed-for-shop'

/** Null when either half is missing: no site URL means no address, and with no
 *  key the route refuses to serve anyway. */
export function feedUrl(siteUrl: string | null, feedToken: string | null, file: FeedFile = 'products.csv'): string | null {
  if (!siteUrl || !feedToken) return null
  return `${siteUrl.replace(/\/+$/, '')}/api/m/${MODULE_NAME}/public/feed/${file}?key=${encodeURIComponent(feedToken)}`
}
