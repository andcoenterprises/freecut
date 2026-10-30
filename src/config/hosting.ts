/**
 * Hosting mode.
 *
 * Upstream FreeCut runs at the site root and stores projects in a folder the
 * user picks. When built with `VITE_HOSTED=alumi` it runs embedded inside
 * AlumiAI Studio instead: served under a sub-path (Vite `base`, e.g.
 * `/editor/`), storing projects in the browser's private file system (OPFS)
 * with no folder picker, and with no service worker (one registered under the
 * host's origin would intercept the host's own pages).
 */

export const HOSTED = import.meta.env.VITE_HOSTED === 'alumi'

/** The path the app is served under, without a trailing slash ('' at the root). */
export const APP_BASE = import.meta.env.BASE_URL.replace(/\/+$/, '')

/** A root-relative public path ('/moss-tts/x.js') under the app's base path. */
export function withBase(path: string): string {
  return `${APP_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

/** The router-relative pathname for a full `window.location.pathname`. */
export function stripBase(pathname: string): string {
  if (!APP_BASE) return pathname
  if (pathname === APP_BASE) return '/'
  return pathname.startsWith(`${APP_BASE}/`) ? pathname.slice(APP_BASE.length) : pathname
}
