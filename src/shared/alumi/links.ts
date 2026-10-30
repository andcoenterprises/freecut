/**
 * Which AlumiAI Studio post an editor project belongs to.
 *
 * Studio opens the editor at /studio?post=<id>; the project it creates is
 * remembered here so reopening the same post reopens the same project (with
 * its edits), and so an export knows which post to save back to. Projects live
 * in this browser's private storage, so the link lives beside them in
 * localStorage.
 */

export interface StudioLink {
  /** A post's own edit, or a video made for the sub-account from its saved media. Older links have no kind: they're posts. */
  kind?: 'post' | 'workspace'
  /** The post, for a post's edit. */
  postId?: string
  workspaceId: string
  /** Where Studio is (the editor is served under it): e.g. https://studio.alumiai.com */
  origin: string
  /** Studio media id → this project's media id, for every file both sides have. */
  mediaMap?: Record<string, string>
}

const KEY = 'alumi-studio-links'

type Links = Record<string, StudioLink>

function read(): Links {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Links) : {}
  } catch {
    return {}
  }
}

function write(links: Links): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(links))
  } catch {
    // Restricted storage: the link is lost, the project itself is not.
  }
}

export function linkProjectToPost(projectId: string, link: StudioLink): void {
  write({ ...read(), [projectId]: link })
}

export function studioLinkForProject(projectId: string): StudioLink | undefined {
  return read()[projectId]
}

export function projectIdForPost(postId: string): string | undefined {
  return Object.entries(read()).find(([, link]) => link.postId === postId)?.[0]
}

export function setLinkMediaMap(projectId: string, mediaMap: Record<string, string>): void {
  const links = read()
  const link = links[projectId]
  if (!link) return
  write({ ...links, [projectId]: { ...link, mediaMap } })
}

export const linkKind = (link: StudioLink): 'post' | 'workspace' =>
  link.kind ?? (link.postId ? 'post' : 'workspace')

/** Where the project JSON is kept in Studio (PUT) and read back (GET). */
export function projectSyncUrl(link: StudioLink, projectId: string): string {
  return linkKind(link) === 'post'
    ? `${link.origin}/api/creative/editor/${encodeURIComponent(link.postId ?? '')}`
    : `${link.origin}/api/creative/editor/workspace/${encodeURIComponent(link.workspaceId)}/projects/${encodeURIComponent(projectId)}`
}

/** Where an uploaded file is recorded in Studio (POST { pathname, url, name }). */
export function uploadRecordUrl(link: StudioLink): string {
  return linkKind(link) === 'post'
    ? `${link.origin}/api/creative/editor/${encodeURIComponent(link.postId ?? '')}`
    : `${link.origin}/api/creative/editor/workspace/${encodeURIComponent(link.workspaceId)}`
}

/** The Blob path uploads go under; Studio's upload token only allows the sub-account's own. */
export function uploadPathPrefix(link: StudioLink): string {
  return linkKind(link) === 'post'
    ? `creative/${link.workspaceId}/media/${link.postId ?? ''}/`
    : `creative/${link.workspaceId}/media/library/`
}

export function forgetProjectLink(projectId: string): void {
  const links = read()
  delete links[projectId]
  write(links)
}
