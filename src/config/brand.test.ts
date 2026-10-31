import { describe, expect, it } from 'vitest'
import { brandDeep, brandText, BRAND_NAME } from './brand'

describe('brand', () => {
  it('leaves text alone when the brand is upstream', () => {
    if (BRAND_NAME !== 'FreeCut') return
    expect(brandText('Welcome to freecut.')).toBe('Welcome to freecut.')
    expect(brandDeep({ a: ['FreeCut'] })).toEqual({ a: ['FreeCut'] })
  })
})

describe('bundle tag', () => {
  it('is freecut upstream and the first brand word when rebranded', async () => {
    const { BUNDLE_TAG, BUNDLE_TAGS } = await import('./brand')
    expect(BUNDLE_TAGS).toContain('freecut')
    expect(BUNDLE_TAGS).toContain(BUNDLE_TAG)
  })
})
