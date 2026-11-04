import { describe, expect, it } from 'vitest'
import type { DocPageContent } from './docs-content'
import { HOSTED_REWRITES, hostedPages, STUDIO_PAGE } from './hosted-docs'

const modules = import.meta.glob<{ default: DocPageContent }>('./pages/*.ts', { eager: true })
const upstream = Object.values(modules).map((m) => m.default)
const allText = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(allText) : v && typeof v === 'object' ? Object.values(v).flatMap(allText) : []

describe('hosted guide', () => {
  it('still finds every sentence it rewrites in the upstream pages', () => {
    const texts = new Set(upstream.flatMap(allText))
    const missing = [...HOSTED_REWRITES.keys()].filter((k) => !texts.has(k))
    expect(missing).toEqual([])
  })

  it('swaps the workspace page for the Studio page and leaves no workspace-folder talk', () => {
    const pages = hostedPages(upstream)
    expect(pages.map((p) => p.slug)).not.toContain('workspaces')
    expect(pages.find((p) => p.slug === 'in-studio')).toBeTruthy()
    expect(pages.flatMap((p) => p.related ?? [])).not.toContain('workspaces')
    expect(pages.flatMap(allText).filter((t) => /workspace folder|workspace picker/i.test(t))).toEqual([])
    expect(pages).toHaveLength(upstream.length)
    expect(STUDIO_PAGE.sections.length).toBeGreaterThan(3)
  })
})
