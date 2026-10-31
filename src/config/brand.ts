/**
 * Product name. Upstream is FreeCut; a host app rebrands with VITE_BRAND_NAME
 * (AlumiAI Studio builds with "AlumiAI Editor"). Everything a person can read
 * goes through brandText (translations do via an i18next post-processor), so
 * the upstream name never shows in a rebranded build.
 */

export const BRAND_NAME: string = import.meta.env.VITE_BRAND_NAME || 'FreeCut'

const REBRANDED = BRAND_NAME !== 'FreeCut'
/** The upstream name as a whole word, any case ("FreeCut", "freecut"); not "FreeCutProjects". */
const UPSTREAM_NAME = /\bfreecut\b/gi

/** `text` with the upstream product name replaced by the brand name. */
export function brandText(text: string): string {
  return REBRANDED ? text.replace(UPSTREAM_NAME, BRAND_NAME) : text
}

/** `value` with every string inside it (however deep) passed through brandText. */
export function brandDeep<T>(value: T): T {
  if (!REBRANDED) return value
  if (typeof value === 'string') return brandText(value) as T
  if (Array.isArray(value)) return value.map((item) => brandDeep(item)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>))
      out[key] = brandDeep(item)
    return out as T
  }
  return value
}
