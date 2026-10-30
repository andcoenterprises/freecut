/**
 * Keep an AlumiAI Studio post's project in Studio.
 *
 * After every save of a project that came from a post (see links.ts), the
 * project JSON goes to Studio's PUT /api/creative/editor/<post>, a few seconds
 * after the last save. Files the person imported into the editor themselves
 * are uploaded to the post first, so the project can be restored on another
 * computer: the link's mediaMap records each Studio media id against the
 * editor's. Studio's own files are already there.
 */

import type { Project, ProjectTimeline } from '@/types/project'
import { createLogger } from '@/shared/logging/logger'
import { onProjectSaved } from './sync-events'
import { projectSyncUrl, setLinkMediaMap, studioLinkForProject, type StudioLink } from './links'
import { uploadFileToStudio } from './save-to-studio'

const logger = createLogger('StudioSync')

const DEBOUNCE_MS = 3000
/** Vercel's request body limit is a little over this. */
const MAX_BODY_BYTES = 4 * 1024 * 1024

export interface SyncDeps {
  /** The bytes of one of the editor's media files. */
  getMediaFile(id: string): Promise<Blob | null>
  /** Its name and type, for the upload. */
  getMediaInfo(id: string): Promise<{ fileName: string; mimeType: string } | undefined>
  fetchImpl?: typeof fetch
}

/** Every media id the timeline's items point at, once each. */
export function referencedMediaIds(timeline: ProjectTimeline | undefined): string[] {
  const ids = new Set<string>()
  for (const item of timeline?.items ?? []) {
    if (item.mediaId) ids.add(item.mediaId)
  }
  return [...ids]
}

/** The timeline with its items' media ids swapped (old id → new id); others untouched. */
export function rewriteMediaIds(
  timeline: ProjectTimeline,
  oldToNew: Record<string, string>,
): ProjectTimeline {
  return {
    ...timeline,
    items: timeline.items.map((item) =>
      item.mediaId && oldToNew[item.mediaId] ? { ...item, mediaId: oldToNew[item.mediaId] } : item,
    ),
  }
}

/** What goes to Studio: the project as stored, minus things only this browser can use. */
export function projectForSync(project: Project): Omit<Project, 'rootFolderHandle' | 'thumbnail'> {
  const { rootFolderHandle: _handle, thumbnail: _thumbnail, ...rest } = project
  return rest
}

async function uploadEditorOnlyMedia(
  project: Project,
  link: StudioLink,
  deps: SyncDeps,
): Promise<Record<string, string>> {
  const map = { ...(link.mediaMap ?? {}) }
  const known = new Set(Object.values(map))
  let changed = false
  for (const id of referencedMediaIds(project.timeline)) {
    if (known.has(id)) continue
    const info = await deps.getMediaInfo(id)
    const blob = await deps.getMediaFile(id)
    if (!info || !blob) continue
    const file = new File([blob], info.fileName, { type: info.mimeType || blob.type })
    const r = await uploadFileToStudio(file, link, deps.fetchImpl)
    if (!r.ok) {
      logger.warn(`Couldn't send ${info.fileName} to Studio: ${r.error}`)
      continue
    }
    map[r.mediaId] = id
    known.add(id)
    changed = true
  }
  if (changed) setLinkMediaMap(project.id, map)
  return map
}

export async function syncProjectToStudio(
  project: Project,
  link: StudioLink,
  deps: SyncDeps,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const mediaMap = await uploadEditorOnlyMedia(project, link, deps)
  const body = JSON.stringify({ project: projectForSync(project), mediaMap })
  if (body.length > MAX_BODY_BYTES) {
    return { ok: false, error: 'This project is too big to keep in Studio (over 4 MB).' }
  }
  const fetchImpl = deps.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(projectSyncUrl(link, project.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: data.error || `Studio answered ${response.status}.` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Studio is unreachable.' }
  }
}

/**
 * Sync every linked project a few seconds after its last save. Returns a stop
 * function. Saves that arrive while a sync runs are sent afterwards.
 */
export function startStudioSync(deps: SyncDeps): () => void {
  const timers = new Map<string, number>()
  const latest = new Map<string, Project>()
  const running = new Set<string>()
  let lastError = ''

  const flush = async (projectId: string) => {
    timers.delete(projectId)
    const project = latest.get(projectId)
    const link = studioLinkForProject(projectId)
    if (!project || !link) return
    if (running.has(projectId)) {
      schedule(projectId)
      return
    }
    running.add(projectId)
    latest.delete(projectId)
    try {
      const r = await syncProjectToStudio(project, link, deps)
      if (!r.ok && r.error !== lastError) {
        lastError = r.error
        logger.warn(`Project ${projectId} isn't saved to Studio yet: ${r.error}`)
      }
      if (r.ok) lastError = ''
    } finally {
      running.delete(projectId)
      if (latest.has(projectId)) schedule(projectId)
    }
  }

  const schedule = (projectId: string) => {
    const existing = timers.get(projectId)
    if (existing !== undefined) window.clearTimeout(existing)
    timers.set(
      projectId,
      window.setTimeout(() => {
        void flush(projectId)
      }, DEBOUNCE_MS),
    )
  }

  const unsubscribe = onProjectSaved((project) => {
    if (!studioLinkForProject(project.id)) return
    latest.set(project.id, project)
    schedule(project.id)
  })

  return () => {
    unsubscribe()
    for (const timer of timers.values()) window.clearTimeout(timer)
    timers.clear()
  }
}
