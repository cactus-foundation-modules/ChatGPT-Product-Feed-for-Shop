// The OpenAI product file, rendered. Pure: it is handed finished rows and turns
// them into text, so every formatting rule in the spec is testable without a
// database. lib/feed-data.ts makes the judgement calls; this only spells them.
//
// Spec: https://developers.openai.com/commerce/specs/file-upload/products

export const AVAILABILITIES = ['in_stock', 'out_of_stock', 'pre_order', 'backorder', 'unknown'] as const
export type Availability = (typeof AVAILABILITIES)[number]

/** One row of the product file. Optional fields left undefined are written as
 *  empty cells (delimited) or left out (JSONL) - the spec reads both as "no
 *  value", and never as zero or false. */
export type FeedRow = {
  item_id: string
  title: string
  description: string
  url: string
  brand: string
  seller_name: string
  image_url: string
  availability: Availability
  price: string
  sale_price?: string
  group_id?: string
  listing_has_variations?: boolean
  variant_dict?: Record<string, string>
  gtin?: string
  mpn?: string
  condition?: string
  product_category?: string
  weight?: string
  item_weight_unit?: string
  additional_image_urls?: string[]
  seller_url?: string
  accepts_returns?: boolean
  return_deadline_in_days?: number
  return_policy?: string
  is_ads_eligible?: boolean
}

/** Column order for the delimited files. Fixed, so a diff of two days' feeds
 *  shows what changed and not how the keys happened to fall. */
export const COLUMNS: ReadonlyArray<keyof FeedRow> = [
  'item_id', 'title', 'description', 'url', 'brand', 'seller_name', 'image_url', 'availability',
  'price', 'sale_price', 'group_id', 'listing_has_variations', 'variant_dict', 'gtin', 'mpn',
  'condition', 'product_category', 'weight', 'item_weight_unit', 'additional_image_urls',
  'seller_url', 'accepts_returns', 'return_deadline_in_days', 'return_policy', 'is_ads_eligible',
]

export const TITLE_MAX = 150
export const DESCRIPTION_MAX = 5000

/** Cuts text to `max` characters, at a word boundary where one is close, with
 *  no trailing punctuation left dangling. */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const space = cut.lastIndexOf(' ')
  const head = space > max * 0.6 ? cut.slice(0, space) : cut
  return head.replace(/[\s,;:\-]+$/, '')
}

/** How many decimal places a currency is written with - two for GBP, none for
 *  JPY. The spec wants exactly the currency's own number. */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/** `79.99 GBP`: decimal point, no thousands separator, uppercase ISO code. */
export function money(amount: number, currency: string): string {
  return `${amount.toFixed(currencyDigits(currency))} ${currency.toUpperCase()}`
}

/** A GTIN the spec will take: 8, 12, 13 or 14 digits with a valid check digit,
 *  spaces and dashes removed, leading zeros kept. Anything else is no GTIN -
 *  an invalid one is worse than none. */
export function validGtin(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const digits = raw.replace(/[\s-]/g, '')
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return undefined
  const body = digits.slice(0, -1)
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    // Weights run 3,1,3,1... from the digit nearest the check digit.
    const digit = Number(body[body.length - 1 - i])
    sum += digit * (i % 2 === 0 ? 3 : 1)
  }
  const check = (10 - (sum % 10)) % 10
  return check === Number(digits[digits.length - 1]) ? digits : undefined
}

/** A URL inside a comma-separated list must not carry a bare comma. */
function listSafeUrl(url: string): string {
  return url.replace(/,/g, '%2C')
}

function cellValue(row: FeedRow, key: keyof FeedRow): string {
  const value = row[key]
  if (value === undefined || value === null) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(listSafeUrl).join(',')
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/** Quotes a cell that holds the delimiter, a quote or a line break, doubling
 *  any quote inside - the rule the spec gives for both CSV and TSV. */
function quote(cell: string, delimiter: string): string {
  return cell.includes(delimiter) || /["\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

export function toDelimited(rows: readonly FeedRow[], delimiter: ',' | '\t'): string {
  const lines = [COLUMNS.join(delimiter)]
  for (const row of rows) lines.push(COLUMNS.map((key) => quote(cellValue(row, key), delimiter)).join(delimiter))
  return lines.join('\n') + '\n'
}

/** One JSON object per line. Undefined fields drop out of JSON.stringify, which
 *  is exactly "omitted" in the spec's terms; arrays and objects stay native. */
export function toJsonl(rows: readonly FeedRow[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '')
}

// ----- File names ------------------------------------------------------------

export const FEED_FILES = [
  'products.csv',
  'products.csv.gz',
  'products.tsv',
  'products.tsv.gz',
  'products.jsonl',
  'products.jsonl.gz',
] as const
export type FeedFile = (typeof FEED_FILES)[number]

export function isFeedFile(value: string): value is FeedFile {
  return (FEED_FILES as readonly string[]).includes(value)
}

/** The body for one of the file names, uncompressed. */
export function renderFeed(rows: readonly FeedRow[], file: FeedFile): string {
  if (file.startsWith('products.jsonl')) return toJsonl(rows)
  return toDelimited(rows, file.startsWith('products.tsv') ? '\t' : ',')
}

export function contentTypeOf(file: FeedFile): string {
  if (file.endsWith('.gz')) return 'application/gzip'
  if (file === 'products.jsonl') return 'application/x-ndjson; charset=utf-8'
  if (file === 'products.tsv') return 'text/tab-separated-values; charset=utf-8'
  return 'text/csv; charset=utf-8'
}
