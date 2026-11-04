/**
 * The Studio AI panel's calls to AlumiAI Studio
 * (/api/creative/editor/workspace/<ws>/ai): Studio's image and video models on fal.ai
 * and the sub-account's ElevenLabs voices, charged to its wallet like everything
 * else in Creative Studio. A clip or picture is a job: start it, poll
 * /api/creative/media/<id> until it's ready, then import /api/creative/images/<id>.
 */

import { linkKind, type StudioLink } from './links'
import { refreshStudioSession } from './session'

export type StudioAiModel = {
  key: string
  label: string
  kind: 'image' | 'video'
  bestFor: string
  priceLabel: string | null
  durations: { min: number; max: number; default: number; values?: number[] } | null
  resolutions: string[] | null
  defaultResolution: string | null
  sound: boolean
}

export type StudioVoice = {
  voiceId: string
  name: string
  description: string
  previewUrl: string | null
}

export type StudioAiOptions = {
  ready: boolean
  voiceReady: boolean
  models: StudioAiModel[]
  aspects: string[]
  voices: StudioVoice[]
  voiceModels: { id: string; label: string; maxChars: number }[]
  currency: string
  free: boolean
}

export type StudioMedia = {
  id: string
  status: 'pending' | 'ready' | 'failed'
  error: string | null
  contentType: string
  prompt: string
}

export type MediaJob = {
  modelKey: string
  prompt: string
  aspectRatio: string
  durationSeconds?: number
  resolution?: string
  sound?: boolean
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string }
type Fetch = typeof fetch

const aiUrl = (link: StudioLink) =>
  `${link.origin}/api/creative/editor/workspace/${encodeURIComponent(link.workspaceId)}/ai`

/** Where a made file is served (the editor imports it from here). */
export const studioMediaFileUrl = (link: StudioLink, id: string) =>
  `${link.origin}/api/creative/images/${encodeURIComponent(id)}`

/** The post this project belongs to, so what's made is kept with the post. */
const postIdOf = (link: StudioLink) => (linkKind(link) === 'post' ? link.postId : undefined)

async function call<T>(
  url: string,
  init: RequestInit | undefined,
  fetchImpl: Fetch,
): Promise<Result<T>> {
  await refreshStudioSession()
  try {
    const response = await fetchImpl(url, { credentials: 'same-origin', ...init })
    const data = (await response.json().catch(() => ({}))) as T & { error?: string }
    if (!response.ok) {
      const fallback =
        response.status === 401 || response.status === 403 || response.status === 404
          ? 'Studio didn’t recognise you. Reload the editor and try again.'
          : `Studio answered ${response.status}. Try again.`
      return { ok: false, error: data.error || fallback }
    }
    return { ok: true, ...data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Studio is unreachable.' }
  }
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export function loadStudioAiOptions(
  link: StudioLink,
  fetchImpl: Fetch = fetch,
): Promise<Result<StudioAiOptions>> {
  return call<StudioAiOptions>(aiUrl(link), undefined, fetchImpl)
}

/** What the job would cost, in the sub-account's wallet currency (amount null: priced after). */
export function quoteStudioMedia(
  link: StudioLink,
  job: Omit<MediaJob, 'prompt'>,
  fetchImpl: Fetch = fetch,
) {
  return call<{ amount: number | null; currency: string; free: boolean; typical: boolean }>(
    aiUrl(link),
    post({ action: 'quote', ...job }),
    fetchImpl,
  )
}

export function startStudioMedia(link: StudioLink, job: MediaJob, fetchImpl: Fetch = fetch) {
  return call<{ media: StudioMedia }>(
    aiUrl(link),
    post({ action: 'generate', ...job, postId: postIdOf(link) }),
    fetchImpl,
  )
}

/** Where a job stands; Studio collects it from fal.ai (and charges) when it's done. */
export function pollStudioMedia(link: StudioLink, id: string, fetchImpl: Fetch = fetch) {
  return call<{ media: StudioMedia }>(
    `${link.origin}/api/creative/media/${encodeURIComponent(id)}`,
    undefined,
    fetchImpl,
  )
}

export function makeStudioVoiceover(
  link: StudioLink,
  opts: { voiceId: string; modelId: string; text: string },
  fetchImpl: Fetch = fetch,
) {
  return call<{ media: StudioMedia }>(
    aiUrl(link),
    post({ action: 'voiceover', ...opts, postId: postIdOf(link) }),
    fetchImpl,
  )
}

/** "A$0.42", or a price label when Studio can't price it beforehand. */
export function formatQuote(
  q: { amount: number | null; currency: string; free: boolean; typical: boolean } | null,
): string {
  if (!q) return ''
  if (q.free) return 'Free for this sub-account'
  if (q.amount === null) return 'Priced from what it actually costs'
  const money = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: q.currency,
  }).format(q.amount)
  return q.typical ? `About ${money}` : money
}

// ── Edit with Alu ───────────────────────────────────────────────────────────────
// /api/creative/editor/workspace/<ws>/edit: a request in plain words → the editor's own
// edit ops, charged to the sub-account's wallet at what the AI actually used.

export type AluOp = { op: string; args: Record<string, unknown>; callerId?: string }
export type AluPlan = {
  understood: string
  ops: AluOp[]
  summary: string[]
  notes: string[]
  checkFrames: number[]
}
export type AluMoney = { amount: number; currency: string }
export type AluRequest = {
  request: string
  timeline: string
  catalog: string
  review?: { plan: string; frames: { frame: number; jpegBase64: string }[] }
}

const editUrl = (link: StudioLink) =>
  `${link.origin}/api/creative/editor/workspace/${encodeURIComponent(link.workspaceId)}/edit`

export function loadAluOptions(link: StudioLink, fetchImpl: Fetch = fetch) {
  return call<{ ready: boolean; estimate: (AluMoney & { free: boolean }) | null }>(
    editUrl(link),
    undefined,
    fetchImpl,
  )
}

export function askAlu(link: StudioLink, body: AluRequest, fetchImpl: Fetch = fetch) {
  return call<{ plan: AluPlan; charged: AluMoney }>(editUrl(link), post(body), fetchImpl)
}

/** "A$0.42" (two decimals; a charge under a cent shows as under a cent). */
export function formatMoney(m: AluMoney): string {
  if (m.amount > 0 && m.amount < 0.01) {
    return `under ${new Intl.NumberFormat(undefined, { style: 'currency', currency: m.currency }).format(0.01)}`
  }
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: m.currency }).format(
    m.amount,
  )
}
