import { describe, expect, it, vi } from 'vitest'
import {
  formatQuote,
  loadStudioAiOptions,
  makeStudioVoiceover,
  pollStudioMedia,
  startStudioMedia,
  studioMediaFileUrl,
} from './studio-ai'
import type { StudioLink } from './links'

vi.mock('./session', () => ({ refreshStudioSession: () => Promise.resolve() }))

const workspace: StudioLink = {
  kind: 'workspace',
  workspaceId: 'w 1',
  origin: 'https://studio.example',
}
const postLink: StudioLink = {
  kind: 'post',
  postId: 'p1',
  workspaceId: 'w1',
  origin: 'https://studio.example',
}

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = []
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('studio-ai', () => {
  it('builds Studio URLs for the sub-account and the made file', async () => {
    const f = fakeFetch(200, { ready: true, models: [] })
    const r = await loadStudioAiOptions(workspace, f.impl)
    expect(r.ok).toBe(true)
    expect(f.calls[0]!.url).toBe('https://studio.example/api/creative/editor/workspace/w%201/ai')
    expect(studioMediaFileUrl(workspace, 'm1')).toBe(
      'https://studio.example/api/creative/images/m1',
    )
    await pollStudioMedia(workspace, 'm1', f.impl)
    expect(f.calls[1]!.url).toBe('https://studio.example/api/creative/media/m1')
  })

  it('sends the post with what a post project makes, and nothing for a sub-account project', async () => {
    const f = fakeFetch(200, { media: { id: 'm1', status: 'pending' } })
    await startStudioMedia(
      postLink,
      { modelKey: 'seedance-2.5', prompt: 'a cafe', aspectRatio: '9:16', durationSeconds: 5 },
      f.impl,
    )
    expect(JSON.parse(String(f.calls[0]!.init!.body))).toMatchObject({
      action: 'generate',
      modelKey: 'seedance-2.5',
      postId: 'p1',
      durationSeconds: 5,
    })
    await makeStudioVoiceover(
      workspace,
      { voiceId: 'v1', modelId: 'eleven_v3', text: 'hi there' },
      f.impl,
    )
    const body = JSON.parse(String(f.calls[1]!.init!.body))
    expect(body).toMatchObject({ action: 'voiceover', voiceId: 'v1', text: 'hi there' })
    expect(body.postId).toBeUndefined()
  })

  it("passes Studio's own error through, and explains a sign-in problem", async () => {
    const short = await startStudioMedia(
      workspace,
      { modelKey: 'x', prompt: 'p', aspectRatio: '1:1' },
      fakeFetch(402, { error: 'The wallet is empty. Top it up.' }).impl,
    )
    expect(short).toEqual({ ok: false, error: 'The wallet is empty. Top it up.' })
    const signedOut = await loadStudioAiOptions(workspace, fakeFetch(404, {}).impl)
    expect(signedOut.ok).toBe(false)
    expect(!signedOut.ok && signedOut.error).toMatch(/Reload the editor/)
  })

  it('formats prices', () => {
    expect(formatQuote({ amount: 0, currency: 'AUD', free: true, typical: false })).toBe(
      'Free for this sub-account',
    )
    expect(formatQuote({ amount: null, currency: 'AUD', free: false, typical: false })).toBe(
      'Priced from what it actually costs',
    )
    expect(formatQuote({ amount: 2.1, currency: 'USD', free: false, typical: true })).toMatch(
      /^About .*2\.10/,
    )
    expect(formatQuote(null)).toBe('')
  })
})
