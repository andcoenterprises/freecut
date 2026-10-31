import { describe, expect, it } from 'vitest'
import { brandDeep, brandText, BRAND_NAME } from './brand'

describe('brand', () => {
  it('leaves text alone when the brand is upstream', () => {
    if (BRAND_NAME !== 'FreeCut') return
    expect(brandText('Welcome to freecut.')).toBe('Welcome to freecut.')
    expect(brandDeep({ a: ['FreeCut'] })).toEqual({ a: ['FreeCut'] })
  })
})
