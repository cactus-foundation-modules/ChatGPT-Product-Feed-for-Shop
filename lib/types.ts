// Settings shape and the normalisers every write and every read runs through.
// Pure - imports nothing - so the client settings tab and the tests can share it.

export const CONDITIONS = ['new', 'refurbished', 'used'] as const
export type Condition = (typeof CONDITIONS)[number]

export type CpfSettings = {
  enabled: boolean
  feedToken: string | null
  sellerName: string | null
  defaultBrand: string | null
  brandFromSupplier: boolean
  mpnFromSku: boolean
  defaultCondition: Condition
  includeOutOfStock: boolean
  /** null = not stated, which OpenAI reads differently from false. */
  acceptsReturns: boolean | null
  returnWindowDays: number | null
  returnPolicyUrl: string | null
  adsEligible: boolean
  lastFetchedAt: string | null
  lastFetchedItems: number | null
  lastFetchAgent: string | null
}

export const BLANK_SETTINGS: CpfSettings = {
  enabled: false,
  feedToken: null,
  sellerName: null,
  defaultBrand: null,
  brandFromSupplier: true,
  mpnFromSku: false,
  defaultCondition: 'new',
  includeOutOfStock: true,
  acceptsReturns: null,
  returnWindowDays: null,
  returnPolicyUrl: null,
  adsEligible: false,
  lastFetchedAt: null,
  lastFetchedItems: null,
  lastFetchAgent: null,
}

export function asCondition(value: unknown): Condition {
  return CONDITIONS.includes(value as Condition) ? (value as Condition) : 'new'
}

/** Trimmed text or null. A box left empty means "not set", never "". */
export function textOrNull(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, max)
  return trimmed || null
}

/** A positive whole number of days, or null. */
export function asReturnWindow(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n > 0 && n <= 3650 ? n : null
}

/** An absolute http(s) URL, or null. OpenAI drops anything else anyway, so a
 *  half-typed address is stored as nothing rather than published broken. */
export function asHttpUrl(value: unknown): string | null {
  const text = textOrNull(value, 2000)
  if (!text) return null
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
