import { afterEach, describe, expect, it, vi } from 'vitest'

describe('rebranded translations', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('shows the brand name wherever a translation says FreeCut', async () => {
    vi.stubEnv('VITE_BRAND_NAME', 'AlumiAI Editor')
    vi.resetModules()
    const [{ default: i18n }, { brandText }] = await Promise.all([
      import('@/i18n'),
      import('@/config/brand'),
    ])
    await new Promise<void>((resolve) => {
      if (i18n.isInitialized) resolve()
      else i18n.on('initialized', () => resolve())
    })
    expect(brandText('Welcome to freecut. Not FreeCutProjects.')).toBe(
      'Welcome to AlumiAI Editor. Not FreeCutProjects.',
    )
    const tts = i18n.t('editor.editor.appLabel')
    expect(tts).not.toMatch(/freecut/i)
    const all = JSON.stringify(i18n.getResourceBundle('en', 'translation'))
    const sample = (all.match(/"[^"]*\bfreecut\b[^"]*"/i) ?? [])[0]
    expect(sample, 'resource bundles keep the upstream text').toBeTruthy()
    const key = Object.keys(flatten(i18n.getResourceBundle('en', 'translation'))).find((k) =>
      /\bfreecut\b/i.test(String(flatten(i18n.getResourceBundle('en', 'translation'))[k])),
    )
    expect(key).toBeTruthy()
    expect(i18n.t(key!)).not.toMatch(/\bfreecut\b/i)
    expect(i18n.t(key!)).toContain('AlumiAI Editor')
  })
})

function flatten(
  obj: unknown,
  prefix = '',
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>))
      flatten(v, prefix ? `${prefix}.${k}` : k, out)
  } else out[prefix] = obj
  return out
}
