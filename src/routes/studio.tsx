/**
 * /studio?post=<id>[&fresh=1]: open an AlumiAI Studio post in the editor.
 *
 * Studio's "Open in editor" lands here. The post's plan and its saved project
 * (if any) come from Studio's GET /api/creative/editor/<post>, same origin
 * with the user's own session. Then, in order of preference:
 *   - a project for this post already in this browser is reopened, after any
 *     new Studio files are added to its media (a newer copy saved in Studio
 *     from another computer replaces it);
 *   - else the project saved in Studio is restored here, its media
 *     re-downloaded;
 *   - else a new project is laid out from the plan
 *     (src/shared/alumi/timeline-from-spec.ts).
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
import { linkProjectToPost, projectIdForPost, studioLinkForProject } from '@/shared/alumi/links'
import { rewriteMediaIds } from '@/shared/alumi/sync'
import {
  timelineFromSpec,
  type ImportedMedia,
  type StudioSpec,
} from '@/shared/alumi/timeline-from-spec'

const logger = createLogger('StudioOpen')

/** A newer copy in Studio wins only when it is clearly newer than this browser's. */
const NEWER_BY_MS = 2000

interface SavedProject {
  project: { id: string; updatedAt: number } & Record<string, unknown>
  mediaMap: Record<string, string>
  savedAt: number
}

type Spec = StudioSpec & { mediaUrlPrefix: string; savedProject: SavedProject | null }

export const Route = createFileRoute('/studio')({
  validateSearch: (search: Record<string, unknown>) => ({
    post: typeof search.post === 'string' ? search.post : '',
    fresh: search.fresh === '1' || search.fresh === 1 || search.fresh === true,
  }),
  component: StudioOpen,
})

async function fetchSpec(origin: string, postId: string): Promise<Spec> {
  const response = await fetch(`${origin}/api/creative/editor/${encodeURIComponent(postId)}`, {
    credentials: 'same-origin',
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(
      body.error ||
        (response.status === 401 || response.status === 403
          ? 'Sign in to Studio first, then open the post again.'
          : `Studio didn't answer (${response.status}).`),
    )
  }
  return (await response.json()) as Spec
}

type Progress = (status: string) => void

/** Import Studio files into a project; returns what each became, by Studio media id. */
async function importFromStudio(
  projectId: string,
  files: { id: string; url: string; fileName: string; mimeType: string }[],
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

function StudioOpen() {
  const { post, fresh } = Route.useSearch()
  const navigate = useNavigate()
  const [status, setStatus] = useState('Fetching the plan…')
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!post) {
      setError('No post was given. Open the editor from a post in Studio.')
      return
    }
    const origin = window.location.origin
    const open = (projectId: string) =>
      navigate({ to: '/editor/$projectId', params: { projectId }, replace: true })

    /** A new project laid out from the plan. */
    const buildFresh = async (spec: Spec) => {
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
      linkProjectToPost(project.id, { postId: post, workspaceId: spec.post.workspaceId, origin })
      const imported = await importFromStudio(project.id, spec.media, setStatus)
      setStatus('Laying out the timeline…')
      await updateProject(project.id, { timeline: timelineFromSpec(spec, imported) })
      linkProjectToPost(project.id, {
        postId: post,
        workspaceId: spec.post.workspaceId,
        origin,
        mediaMap: mediaMapOf(imported),
      })
      return project.id
    }

    /** The project saved in Studio, rebuilt here: its files downloaded again, ids relinked. */
    const restoreSaved = async (spec: Spec, saved: SavedProject, into?: Project) => {
      setStatus('Restoring your edit from Studio…')
      // Studio keeps the project exactly as this editor saved it.
      const savedProject = saved.project as unknown as Project
      const projectId = into?.id ?? saved.project.id
      const files = Object.keys(saved.mediaMap).map((id) => ({
        id,
        url: `${spec.mediaUrlPrefix}${id}`,
        fileName: spec.media.find((m) => m.id === id)?.fileName ?? id,
        mimeType: spec.media.find((m) => m.id === id)?.mimeType ?? '',
      }))
      if (!into) {
        const { id: _id, timeline: _timeline, ...rest } = savedProject
        await createProject({
          ...rest,
          id: projectId,
          name: typeof rest.name === 'string' ? rest.name : spec.post.name,
        } as Project)
      }
      linkProjectToPost(projectId, { postId: post, workspaceId: spec.post.workspaceId, origin })
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
      linkProjectToPost(projectId, {
        postId: post,
        workspaceId: spec.post.workspaceId,
        origin,
        mediaMap: mediaMapOf(imported),
      })
      return projectId
    }

    /** This browser's project for the post: new Studio files added to its media first. */
    const reopenLocal = async (spec: Spec, local: Project) => {
      const link = studioLinkForProject(local.id)
      const mediaMap = { ...(link?.mediaMap ?? {}) }
      const missing = spec.media.filter((m) => !mediaMap[m.id])
      if (missing.length) {
        const imported = await importFromStudio(local.id, missing, setStatus)
        Object.assign(mediaMap, mediaMapOf(imported))
        linkProjectToPost(local.id, {
          postId: post,
          workspaceId: spec.post.workspaceId,
          origin,
          mediaMap,
        })
      }
      return local.id
    }

    void (async () => {
      try {
        const spec = await fetchSpec(origin, post)
        const existingId = fresh ? undefined : projectIdForPost(post)
        const local = existingId ? await getProject(existingId) : undefined
        const saved = fresh ? null : spec.savedProject
        let projectId: string
        if (local) {
          projectId =
            saved && saved.project.updatedAt > local.updatedAt + NEWER_BY_MS
              ? await restoreSaved(spec, saved, local)
              : await reopenLocal(spec, local)
        } else if (saved) {
          const clash = await getProject(saved.project.id)
          projectId = await restoreSaved(spec, saved, clash)
        } else {
          projectId = await buildFresh(spec)
        }
        await open(projectId)
      } catch (err) {
        logger.error('Opening the post failed', err)
        setError(err instanceof Error ? err.message : 'Something went wrong opening the post.')
      }
    })()
  }, [fresh, navigate, post])

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
            <p className="text-sm text-foreground">Opening your post in the editor</p>
            <p className="text-xs text-muted-foreground">{status}</p>
          </>
        )}
      </div>
    </div>
  )
}
