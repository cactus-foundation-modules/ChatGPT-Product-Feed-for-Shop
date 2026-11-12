// GET/PATCH/POST /api/m/chatgpt-product-feed-for-shop/admin/settings
//
// GET reads, PATCH saves, POST { action: 'regenerate-key' } replaces the feed
// key - which cuts the old address off at once, so the owner must paste the
// new one into ChatGPT.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getSiteUrlOrNull } from '@/lib/config/env'
import { getCpfSettings, regenerateCpfFeedToken, updateCpfSettings } from '@/modules/chatgpt-product-feed-for-shop/lib/settings'
import { effectiveSellerName } from '@/modules/chatgpt-product-feed-for-shop/lib/feed-data'
import { feedUrl } from '@/modules/chatgpt-product-feed-for-shop/lib/feed-url'
import { FEED_FILES } from '@/modules/chatgpt-product-feed-for-shop/lib/feed-format'
import { CONDITIONS } from '@/modules/chatgpt-product-feed-for-shop/lib/types'

async function view() {
  const settings = await getCpfSettings()
  const siteUrl = getSiteUrlOrNull()
  const { feedToken: _feedToken, ...rest } = settings
  return {
    ...rest,
    // The key travels only inside the addresses, never on its own.
    feedUrls: Object.fromEntries(FEED_FILES.map((file) => [file, feedUrl(siteUrl, settings.feedToken, file)])),
    effectiveSellerName: await effectiveSellerName(settings),
  }
}

async function authorise(): Promise<Response | null> {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'shop.manage')) return errorResponse('Forbidden', 403)
  return null
}

export async function GET() {
  const denied = await authorise()
  if (denied) return denied
  return NextResponse.json(await view())
}

const Patch = z.object({
  enabled: z.boolean().optional(),
  // Length caps only stop a paste of half a page reaching the column; the
  // normalisers in lib/types do the real shaping.
  sellerName: z.string().max(200).nullable().optional(),
  defaultBrand: z.string().max(200).nullable().optional(),
  brandFromSupplier: z.boolean().optional(),
  mpnFromSku: z.boolean().optional(),
  defaultCondition: z.enum(CONDITIONS).optional(),
  includeOutOfStock: z.boolean().optional(),
  acceptsReturns: z.boolean().nullable().optional(),
  returnWindowDays: z.union([z.number().int().min(1).max(3650), z.literal(''), z.null()]).optional(),
  returnPolicyUrl: z.string().max(2000).nullable().optional(),
  adsEligible: z.boolean().optional(),
}).strict()

export async function PATCH(request: Request) {
  const denied = await authorise()
  if (denied) return denied
  const parsed = Patch.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid settings', 400)
  await updateCpfSettings(parsed.data)
  return NextResponse.json(await view())
}

const Action = z.object({ action: z.literal('regenerate-key') })

export async function POST(request: Request) {
  const denied = await authorise()
  if (denied) return denied
  const parsed = Action.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('Unknown action', 400)
  await regenerateCpfFeedToken()
  return NextResponse.json(await view())
}
