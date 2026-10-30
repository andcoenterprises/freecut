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
  postId: string
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

export function forgetProjectLink(projectId: string): void {
  const links = read()
  delete links[projectId]
  write(links)
}
