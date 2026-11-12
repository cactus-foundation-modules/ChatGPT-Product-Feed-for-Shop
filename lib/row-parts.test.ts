import { describe, expect, it } from 'vitest'
import {
  absoluteUrl,
  availabilityOf,
  brandOf,
  buildCategoryPaths,
  orderedImages,
  returnsOf,
  weightOf,
} from '@/modules/chatgpt-product-feed-for-shop/lib/row-parts'

describe('availabilityOf', () => {
  const stock = { trackInventory: true, stockCount: 0, outOfStockBehaviour: 'HIDE', isPreOrder: false }
  it('puts pre-order ahead of stock', () => {
    expect(availabilityOf({ ...stock, isPreOrder: true })).toBe('pre_order')
  })
  it('treats untracked stock as in stock', () => {
    expect(availabilityOf({ ...stock, trackInventory: false })).toBe('in_stock')
  })
  it('reads the out-of-stock behaviour', () => {
    expect(availabilityOf(stock)).toBe('out_of_stock')
    expect(availabilityOf({ ...stock, outOfStockBehaviour: 'BACKORDER' })).toBe('backorder')
    expect(availabilityOf({ ...stock, stockCount: 3 })).toBe('in_stock')
  })
})

describe('brandOf', () => {
  it('takes the nearest non-blank supplier when allowed', () => {
    expect(brandOf(['  ', 'Parent Co'], { brandFromSupplier: true, defaultBrand: 'House' })).toBe('Parent Co')
  })
  it('falls back to the default, and to nothing', () => {
    expect(brandOf(['Maker'], { brandFromSupplier: false, defaultBrand: 'House' })).toBe('House')
    expect(brandOf([null], { brandFromSupplier: true, defaultBrand: null })).toBeUndefined()
  })
})

describe('absoluteUrl and orderedImages', () => {
  it('keeps full addresses and roots site paths', () => {
    expect(absoluteUrl('https://cdn.test/a.jpg', 'https://shop.test')).toBe('https://cdn.test/a.jpg')
    expect(absoluteUrl('/media/a.jpg', 'https://shop.test/')).toBe('https://shop.test/media/a.jpg')
    expect(absoluteUrl('//cdn.test/a.jpg', 'https://shop.test')).toBe('https://cdn.test/a.jpg')
    expect(absoluteUrl('a.jpg', 'https://shop.test')).toBeUndefined()
  })
  it('drops blanks and duplicates that differ only by query', () => {
    expect(orderedImages(['https://c.test/a.jpg?v=1', '', 'https://c.test/a.jpg?v=2', '/b.jpg'], 'https://s.test'))
      .toEqual(['https://c.test/a.jpg?v=1', 'https://s.test/b.jpg'])
  })
})

describe('weightOf', () => {
  it('sends weight and unit together or not at all', () => {
    expect(weightOf('12.5', 'KG')).toEqual({ weight: '12.5', unit: 'kg' })
    expect(weightOf(3, 'lbs')).toEqual({ weight: '3', unit: 'lb' })
    expect(weightOf(3, 'stone')).toBeUndefined()
    expect(weightOf(0, 'kg')).toBeUndefined()
    expect(weightOf(null, 'kg')).toBeUndefined()
  })
})

describe('returnsOf', () => {
  it('says no for a row the shop will not take back, whatever the shop-wide answer', () => {
    expect(returnsOf(false, { acceptsReturns: true, returnWindowDays: 30 })).toEqual({ accepts_returns: false })
  })
  it('sends the window only with a yes', () => {
    expect(returnsOf(true, { acceptsReturns: true, returnWindowDays: 30 })).toEqual({ accepts_returns: true, return_deadline_in_days: 30 })
    expect(returnsOf(true, { acceptsReturns: false, returnWindowDays: 30 })).toEqual({ accepts_returns: false })
  })
  it('leaves an unstated answer unstated', () => {
    expect(returnsOf(true, { acceptsReturns: null, returnWindowDays: 30 })).toEqual({})
  })
})

describe('buildCategoryPaths', () => {
  it('walks to the root, and survives a cycle', () => {
    const paths = buildCategoryPaths([
      { id: 'a', name: 'Furniture', parentId: null },
      { id: 'b', name: 'Desks', parentId: 'a' },
      { id: 'x', name: 'Loop', parentId: 'y' },
      { id: 'y', name: 'Back', parentId: 'x' },
    ])
    expect(paths.get('b')).toBe('Furniture > Desks')
    expect(paths.get('x')).toBeDefined()
  })
})
