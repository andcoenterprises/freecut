/**
 * Keep the AlumiAI Studio sign-in fresh while the editor is open.
 *
 * Studio (Clerk) signs every request with a session token that lasts about a
 * minute; Studio's own pages renew it in the background. The editor tab runs
 * none of Studio's code, and Clerk can renew an expired token only on a page or
 * iframe load (its "handshake" redirect), never on a fetch or script request.
 * Without this, a minute after the editor opens, every call to Studio (saving
 * the project, uploading, saving an export) is answered as signed out.
 *
 * So while the tab is visible, and right before talking to Studio, the editor
 * loads a tiny file in a hidden iframe: Studio renews the token on that load and
 * the next fetch carries a valid one.
 */

import { HOSTED, withBase } from '@/config/hosting'

/** Renew a little before Clerk's one-minute token runs out. */
export const REFRESH_EVERY_MS = 45_000
const LOAD_TIMEOUT_MS = 10_000

let lastRefresh = 0
let inFlight: Promise<void> | null = null

function keepAliveUrl(): string {
  return `${withBase('/session-keepalive.html')}?t=${Date.now()}`
}

/**
 * Renew the Studio sign-in unless that happened in the last 45 seconds.
 * Resolves when the hidden load finishes (or after 10 s); never rejects.
 */
export function refreshStudioSession(options: { force?: boolean } = {}): Promise<void> {
  // Only a build hosted inside Studio has a Studio sign-in to keep.
  if (!HOSTED || typeof document === 'undefined' || !document.body) return Promise.resolve()
  if (!options.force && Date.now() - lastRefresh < REFRESH_EVERY_MS) return Promise.resolve()
  if (inFlight) return inFlight
  inFlight = new Promise<void>((resolve) => {
    const frame = document.createElement('iframe')
    frame.hidden = true
    frame.tabIndex = -1
    frame.setAttribute('aria-hidden', 'true')
    let timer = 0
    const done = () => {
      window.clearTimeout(timer)
      frame.remove()
      resolve()
    }
    timer = window.setTimeout(done, LOAD_TIMEOUT_MS)
    frame.addEventListener(
      'load',
      () => {
        lastRefresh = Date.now()
        done()
      },
      { once: true },
    )
    frame.src = keepAliveUrl()
    document.body.appendChild(frame)
  }).finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Renew the sign-in every 45 seconds while the tab is visible. Returns a stop function. */
export function keepStudioSessionFresh(): () => void {
  const tick = () => {
    if (document.visibilityState === 'visible') void refreshStudioSession()
  }
  tick()
  const interval = window.setInterval(tick, REFRESH_EVERY_MS)
  document.addEventListener('visibilitychange', tick)
  return () => {
    window.clearInterval(interval)
    document.removeEventListener('visibilitychange', tick)
  }
}
