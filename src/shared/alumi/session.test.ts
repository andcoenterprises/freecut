import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
type Session = typeof import('./session')

describe('refreshStudioSession', () => {
  let refreshStudioSession: Session['refreshStudioSession']
  let REFRESH_EVERY_MS: number
  beforeEach(async () => {
    vi.stubEnv('VITE_HOSTED', 'alumi')
    vi.resetModules()
    ;({ refreshStudioSession, REFRESH_EVERY_MS } = await import('./session'))
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    document.body.innerHTML = ''
  })

  const frames = () => [...document.querySelectorAll('iframe')]

  it('loads the keep-alive file in a hidden iframe and removes it once loaded', async () => {
    const done = refreshStudioSession()
    const [frame] = frames()
    expect(frame?.hidden).toBe(true)
    expect(frame?.src).toContain('/session-keepalive.html?t=')
    frame!.dispatchEvent(new Event('load'))
    await done
    expect(frames()).toHaveLength(0)
  })

  it('shares one load between overlapping calls and skips a renewal made under 45 s ago', async () => {
    const a = refreshStudioSession()
    const b = refreshStudioSession()
    expect(frames()).toHaveLength(1)
    frames()[0]!.dispatchEvent(new Event('load'))
    await Promise.all([a, b])
    await refreshStudioSession()
    expect(frames()).toHaveLength(0)
    vi.advanceTimersByTime(REFRESH_EVERY_MS + 1)
    void refreshStudioSession()
    expect(frames()).toHaveLength(1)
  })

  it('does nothing in a build that is not hosted in Studio', async () => {
    vi.unstubAllEnvs()
    vi.resetModules()
    const session = await import('./session')
    await session.refreshStudioSession({ force: true })
    expect(frames()).toHaveLength(0)
  })

  it('gives up after 10 s without failing when the load never finishes', async () => {
    const done = refreshStudioSession()
    vi.advanceTimersByTime(10_000)
    await expect(done).resolves.toBeUndefined()
    expect(frames()).toHaveLength(0)
  })
})
