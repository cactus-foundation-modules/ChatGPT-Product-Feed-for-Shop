import { describe, expect, it } from 'vitest'
import { asCondition, asHttpUrl, asReturnWindow, textOrNull } from '@/modules/chatgpt-product-feed-for-shop/lib/types'

describe('normalisers', () => {
  it('asCondition falls back to new', () => {
    expect(asCondition('used')).toBe('used')
    expect(asCondition('mint')).toBe('new')
  })
  it('textOrNull trims and empties to null', () => {
    expect(textOrNull('  Shop  ')).toBe('Shop')
    expect(textOrNull('   ')).toBeNull()
    expect(textOrNull(4)).toBeNull()
  })
  it('asReturnWindow takes positive whole days only', () => {
    expect(asReturnWindow('30')).toBe(30)
    expect(asReturnWindow(0)).toBeNull()
    expect(asReturnWindow('')).toBeNull()
    expect(asReturnWindow('abc')).toBeNull()
  })
  it('asHttpUrl takes absolute http(s) only', () => {
    expect(asHttpUrl('https://shop.test/returns')).toBe('https://shop.test/returns')
    expect(asHttpUrl('javascript:alert(1)')).toBeNull()
    expect(asHttpUrl('/returns')).toBeNull()
  })
})
