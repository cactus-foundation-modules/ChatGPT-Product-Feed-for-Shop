import { describe, expect, it } from 'vitest'
import {
  COLUMNS,
  clip,
  contentTypeOf,
  currencyDigits,
  isFeedFile,
  money,
  renderFeed,
  toDelimited,
  toJsonl,
  validGtin,
  type FeedRow,
} from '@/modules/chatgpt-product-feed-for-shop/lib/feed-format'

const base: FeedRow = {
  item_id: 'child-1',
  title: 'Desk - Oak, 1600mm',
  description: 'A desk, "solid", with a drawer',
  url: 'https://shop.test/p/desk?finish=oak',
  brand: 'Maker',
  seller_name: 'Shop Ltd',
  image_url: 'https://cdn.test/a.jpg',
  availability: 'in_stock',
  price: '199.00 GBP',
}

describe('money', () => {
  it('writes the amount, a space and the upper-case code', () => {
    expect(money(79.9, 'gbp')).toBe('79.90 GBP')
    expect(money(1234567.5, 'GBP')).toBe('1234567.50 GBP')
  })
  it('uses the currency’s own decimal places', () => {
    expect(currencyDigits('JPY')).toBe(0)
    expect(money(1500, 'JPY')).toBe('1500 JPY')
  })
})

describe('validGtin', () => {
  it('accepts valid codes of every allowed length, keeping leading zeros', () => {
    expect(validGtin('4006381333931')).toBe('4006381333931')
    expect(validGtin('036000291452')).toBe('036000291452')
    expect(validGtin('96385074')).toBe('96385074')
    expect(validGtin('00012345600012')).toBe('00012345600012')
  })
  it('strips spaces and dashes', () => {
    expect(validGtin('4006-381 333931')).toBe('4006381333931')
  })
  it('refuses a wrong check digit, a wrong length, letters and nothing', () => {
    expect(validGtin('4006381333932')).toBeUndefined()
    expect(validGtin('123456789')).toBeUndefined()
    expect(validGtin('ABC1234567890')).toBeUndefined()
    expect(validGtin(null)).toBeUndefined()
    expect(validGtin('')).toBeUndefined()
  })
})

describe('clip', () => {
  it('leaves short text alone and tidies whitespace', () => {
    expect(clip('  a   b ', 10)).toBe('a b')
  })
  it('cuts at a word boundary within the limit', () => {
    const out = clip('one two three four five', 13)
    expect(out.length).toBeLessThanOrEqual(13)
    expect(out).toBe('one two three')
  })
})

describe('toDelimited', () => {
  it('writes the header in the fixed column order', () => {
    const [header] = toDelimited([], ',').split('\n')
    expect(header).toBe(COLUMNS.join(','))
  })
  it('quotes cells with commas or quotes and doubles the quotes', () => {
    const line = toDelimited([base], ',').split('\n')[1]!
    expect(line).toContain('"A desk, ""solid"", with a drawer"')
    expect(line).toContain('"Desk - Oak, 1600mm"')
  })
  it('writes booleans lower case, objects as JSON and empty cells for nothing', () => {
    const row: FeedRow = {
      ...base,
      listing_has_variations: true,
      variant_dict: { Finish: 'Oak' },
      accepts_returns: false,
      additional_image_urls: ['https://cdn.test/b.jpg', 'https://cdn.test/c,d.jpg'],
    }
    const cells = toDelimited([row], '\t').split('\n')[1]!.split('\t')
    const at = (key: keyof FeedRow) => cells[COLUMNS.indexOf(key)]
    expect(at('listing_has_variations')).toBe('true')
    expect(at('accepts_returns')).toBe('false')
    expect(at('variant_dict')).toBe('"{""Finish"":""Oak""}"')
    expect(at('additional_image_urls')).toBe('https://cdn.test/b.jpg,https://cdn.test/c%2Cd.jpg')
    expect(at('sale_price')).toBe('')
    expect(at('gtin')).toBe('')
  })
  it('quotes a TSV cell holding a tab or line break', () => {
    const line = toDelimited([{ ...base, description: 'a\tb\nc' }], '\t').split('\n').slice(1).join('\n')
    expect(line).toContain('"a\tb\nc"')
  })
})

describe('toJsonl', () => {
  it('writes one object per line with native arrays and objects, omitting unset fields', () => {
    const text = toJsonl([{ ...base, variant_dict: { Size: 'L' }, additional_image_urls: ['https://cdn.test/b.jpg'] }, base])
    const lines = text.trim().split('\n')
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(first.variant_dict).toEqual({ Size: 'L' })
    expect(first.additional_image_urls).toEqual(['https://cdn.test/b.jpg'])
    expect('sale_price' in first).toBe(false)
  })
  it('is empty for no rows', () => {
    expect(toJsonl([])).toBe('')
  })
})

describe('file names', () => {
  it('knows its six files and nothing else', () => {
    expect(isFeedFile('products.csv')).toBe(true)
    expect(isFeedFile('products.jsonl.gz')).toBe(true)
    expect(isFeedFile('products.xml')).toBe(false)
    expect(isFeedFile('../secrets')).toBe(false)
  })
  it('renders the format the name asks for', () => {
    expect(renderFeed([base], 'products.jsonl').startsWith('{')).toBe(true)
    expect(renderFeed([base], 'products.tsv.gz').split('\n')[0]).toContain('\t')
    expect(renderFeed([base], 'products.csv').split('\n')[0]).toContain(',')
  })
  it('labels each one', () => {
    expect(contentTypeOf('products.csv.gz')).toBe('application/gzip')
    expect(contentTypeOf('products.csv')).toMatch(/^text\/csv/)
    expect(contentTypeOf('products.jsonl')).toMatch(/ndjson/)
  })
})
