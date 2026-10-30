/**
 * /studio: open the editor from AlumiAI Studio.
 *
 *   ?post=<id>[&fresh=1]            a post's edit
 *   ?workspace=<id>&project=<id>    a video made for the sub-account, kept in Studio
 *   ?workspace=<id>[&shape=WxH][&media=a,b,c]   a new video from the sub-account's saved media
 *
 * Studio describes what to open (GET /api/creative/editor/<post> or
 * /api/creative/editor/workspace/<id>, same origin with the user's session). Then,
 * in order of preference: a project already in this browser is reopened (for a
 * post, after any new Studio files are added to its media; a newer copy saved
 * in Studio from another computer replaces it); else the project saved in Studio
 * is restored here, its media re-downloaded; else a new project is made (laid
 * out from the plan for a post; from the picked files for a sub-account).
 * `fresh=1` skips straight to a new layout from the plan.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createProject, getProject, updateProject } from '@/infrastructure/storage'
import { createProjectObject } from '@/features/projects/utils/project-helpers'
import { mediaLibraryService } from '@/features/media-library/services/media-library-service'
import type { Project } from '@/types/project'
import { createLogger } from '@/shared/logging/logger'
import {
  linkProjectToPost,
  projectIdForPost,
  studioLinkForProject,
  type StudioLink,
} from '@/shared/alumi/links'
import { rewriteMediaIds } from '@/shared/alumi/sync'
import {
  timelineFromSpec,
  type ImportedMedia,
  type StudioSpec,
} from '@/shared/alumi/timeline-from-spec'

const logger = createLogger('StudioOpen')

/** A newer copy in Studio wins only when it is clearly newer than this browser's. */
const NEWER_BY_MS = 2000
const DEFAULT_FPS = 30

interface SavedProject {
  project: { id: string; updatedAt: number } & Record<string, unknown>
  mediaMap: Record<string, string>
  savedAt: number
}

type MediaFile = { id: string; url: string; fileName: string; mimeType: string }

type PostSpec = StudioSpec & { mediaUrlPrefix: string; savedProject: SavedProject | null }

interface WorkspaceSpec {
  workspace: { id: string; name: string }
  mediaUrlPrefix: string
  fileUrlPrefix: string
  media: MediaFile[]
}

/** Everything restoring a saved project needs to know about where its files are. */
interface Source {
  media: MediaFile[]
  mediaUrlPrefix: string
  fileUrlPrefix?: string
  name: string
}

export const Route = createFileRoute('/studio')({
  validateSearch: (search: Record<string, unknown>) => ({
    post: typeof search.post === 'string' ? search.post : '',
    fresh: search.fresh === '1' || search.fresh === 1 || search.fresh === true,
    workspace: typeof search.workspace === 'string' ? search.workspace : '',
    project: typeof search.project === 'string' ? search.project : '',
    media: typeof search.media === 'string' ? search.media : '',
    shape: typeof search.shape === 'string' ? search.shape : '',
  }),
  component: StudioOpen,
})

async function fetchJson<T>(url: string, notFoundIsNull: false): Promise<T>
async function fetchJson<T>(url: string, notFoundIsNull: true): Promise<T | null>
async function fetchJson<T>(url: string, notFoundIsNull: boolean): Promise<T | null> {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (response.status === 404 && notFoundIsNull) return null
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(
      body.error ||
        (response.status === 401 || response.status === 403
          ? 'Sign in to Studio first, then try again.'
          : `Studio didn't answer (${response.status}).`),
    )
  }
  return (await response.json()) as T
}

type Progress = (status: string) => void

/** Import Studio files into a project; returns what each became, by Studio media id. */
async function importFromStudio(
  projectId: string,
  files: MediaFile[],
  progress: Progress,
): Promise<Map<string, ImportedMedia>> {
  const imported = new Map<string, ImportedMedia>()
  for (const [index, media] of files.entries()) {
    progress(`Importing ${index + 1} of ${files.length}: ${media.fileName}`)
    try {
      const meta = await mediaLibraryService.importMediaFromUrl(media.url, projectId)
      imported.set(media.id, {
        id: meta.id,
        mimeType: meta.mimeType || media.mimeType,
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
        hasAudio: Boolean(meta.audioCodec),
      })
    } catch (err) {
      logger.warn(`Importing ${media.fileName} failed`, err)
    }
  }
  return imported
}

const mediaMapOf = (imported: Map<string, ImportedMedia>): Record<string, string> =>
  Object.fromEntries([...imported].map(([studioId, m]) => [studioId, m.id]))

/** Where a Studio media id can be fetched: brand files are "file:<id>", the rest post media. */
function fileFor(source: Source, id: string): MediaFile {
  const known = source.media.find((m) => m.id === id)
  if (known) return known
  const url = id.startsWith('file:')
    ? `${source.fileUrlPrefix ?? source.mediaUrlPrefix}${id.slice(5)}`
    : `${source.mediaUrlPrefix}${id}`
  return { id, url, fileName: id, mimeType: '' }
}

function parseShape(shape: string): { width: number; height: number } {
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(shape)
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1080, height: 1920 }
}

function StudioOpen() {
  const {
    post,
    fresh,
    workspace,
    project: wantedProject,
    media: pickedIds,
    shape,
  } = Route.useSearch()
  const navigate = useNavigate()
  const [status, setStatus] = useState('Asking Studio what to open…')
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!post && !workspace) {
      setError('Nothing was given to open. Open the editor from Studio.')
      return
    }
    const origin = window.location.origin
    const open = (projectId: string) =>
      navigate({ to: '/editor/$projectId', params: { projectId }, replace: true })

    /** The project saved in Studio, rebuilt here: its files downloaded again, ids relinked. */
    const restoreSaved = async (
      source: Source,
      saved: SavedProject,
      link: StudioLink,
      into?: Project,
    ) => {
      setStatus('Restoring your edit from Studio…')
      // Studio keeps the project exactly as this editor saved it.
      const savedProject = saved.project as unknown as Project
      const projectId = into?.id ?? saved.project.id
      const files = Object.keys(saved.mediaMap).map((id) => fileFor(source, id))
      if (!into) {
        const { id: _id, timeline: _timeline, ...rest } = savedProject
        await createProject({
          ...rest,
          id: projectId,
          name: typeof rest.name === 'string' ? rest.name : source.name,
        } as Project)
      }
      linkProjectToPost(projectId, link)
      const imported = await importFromStudio(projectId, files, setStatus)
      const oldToNew: Record<string, string> = {}
      for (const [studioId, oldEditorId] of Object.entries(saved.mediaMap)) {
        const now = imported.get(studioId)
        if (now) oldToNew[oldEditorId] = now.id
      }
      setStatus('Laying out the timeline…')
      const { id: _id2, createdAt: _c, updatedAt: _u, ...fields } = savedProject
      await updateProject(projectId, {
        ...fields,
        timeline: fields.timeline ? rewriteMediaIds(fields.timeline, oldToNew) : undefined,
      })
      linkProjectToPost(projectId, { ...link, mediaMap: mediaMapOf(imported) })
      return projectId
    }

    const openPost = async () => {
      const spec = await fetchJson<PostSpec>(
        `${origin}/api/creative/editor/${encodeURIComponent(post)}`,
        false,
      )
      const link: StudioLink = {
        kind: 'post',
        postId: post,
        workspaceId: spec.post.workspaceId,
        origin,
      }
      const source: Source = {
        media: spec.media,
        mediaUrlPrefix: spec.mediaUrlPrefix,
        name: spec.post.name,
      }

      /** A new project laid out from the plan. */
      const buildFresh = async () => {
        setStatus('Creating the project…')
        const project = await createProject(
          createProjectObject({
            name: spec.post.name,
            description: 'From AlumiAI Studio',
            width: spec.post.width,
            height: spec.post.height,
            fps: spec.post.fps,
          }),
        )
        linkProjectToPost(project.id, link)
        const imported = await importFromStudio(project.id, spec.media, setStatus)
        setStatus('Laying out the timeline…')
        await updateProject(project.id, { timeline: timelineFromSpec(spec, imported) })
        linkProjectToPost(project.id, { ...link, mediaMap: mediaMapOf(imported) })
        return project.id
      }

      /** This browser's project for the post: new Studio files added to its media first. */
      const reopenLocal = async (local: Project) => {
        const mediaMap = { ...(studioLinkForProject(local.id)?.mediaMap ?? {}) }
        const missing = spec.media.filter((m) => !mediaMap[m.id])
        if (missing.length) {
          Object.assign(mediaMap, mediaMapOf(await importFromStudio(local.id, missing, setStatus)))
          linkProjectToPost(local.id, { ...link, mediaMap })
        }
        return local.id
      }

      const existingId = fresh ? undefined : projectIdForPost(post)
      const local = existingId ? await getProject(existingId) : undefined
      const saved = fresh ? null : spec.savedProject
      if (local) {
        return saved && saved.project.updatedAt > local.updatedAt + NEWER_BY_MS
          ? restoreSaved(source, saved, link, local)
          : reopenLocal(local)
      }
      if (saved) return restoreSaved(source, saved, link, await getProject(saved.project.id))
      return buildFresh()
    }

    const openWorkspace = async () => {
      const spec = await fetchJson<WorkspaceSpec>(
        `${origin}/api/creative/editor/workspace/${encodeURIComponent(workspace)}`,
        false,
      )
      const link: StudioLink = { kind: 'workspace', workspaceId: workspace, origin }
      const source: Source = {
        media: spec.media,
        mediaUrlPrefix: spec.mediaUrlPrefix,
        fileUrlPrefix: spec.fileUrlPrefix,
        name: 'Untitled video',
      }
      if (wantedProject) {
        const local = await getProject(wantedProject)
        const saved = await fetchJson<SavedProject>(
          `${origin}/api/creative/editor/workspace/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(wantedProject)}`,
          true,
        )
        if (local && (!saved || saved.project.updatedAt <= local.updatedAt + NEWER_BY_MS)) {
          if (!studioLinkForProject(local.id)) linkProjectToPost(local.id, link)
          return local.id
        }
        if (saved) return restoreSaved(source, saved, link, local)
        throw new Error("That video isn't in this browser or in Studio any more.")
      }
      setStatus('Creating the video…')
      const { width, height } = parseShape(shape)
      const project = await createProject(
        createProjectObject({
          name: 'Untitled video',
          description: `For ${spec.workspace.name} in AlumiAI Studio`,
          width,
          height,
          fps: DEFAULT_FPS,
        }),
      )
      linkProjectToPost(project.id, link)
      const wanted = new Set(pickedIds.split(',').filter(Boolean))
      const files = spec.media.filter((m) => wanted.has(m.id))
      const imported = files.length
        ? await importFromStudio(project.id, files, setStatus)
        : new Map()
      linkProjectToPost(project.id, { ...link, mediaMap: mediaMapOf(imported) })
      // A save after linking, so Studio keeps the new video straight away.
      await updateProject(project.id, { description: project.description })
      return project.id
    }

    void (async () => {
      try {
        await open(await (post ? openPost() : openWorkspace()))
      } catch (err) {
        logger.error('Opening from Studio failed', err)
        setError(err instanceof Error ? err.message : 'Something went wrong opening the editor.')
      }
    })()
  }, [fresh, navigate, pickedIds, post, shape, wantedProject, workspace])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 space-y-4 text-center">
        {error ? (
          <>
            <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
            <p className="text-sm text-foreground">{error}</p>
            <Button variant="outline" onClick={() => window.close()}>
              Close this tab
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-foreground">Opening the editor</p>
            <p className="text-xs text-muted-foreground">{status}</p>
          </>
        )}
      </div>
    </div>
  )
}
