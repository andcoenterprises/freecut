/**
 * /studio?post=<id>: open an AlumiAI Studio post in the editor.
 *
 * Studio's "Open in editor" button lands here. The post's plan comes from
 * Studio's GET /api/creative/editor/<post> (same origin, the user's own
 * session); its media is imported, laid out on a timeline
 * (src/shared/alumi/timeline-from-spec.ts), and the editor opens. Opening the
 * same post again reopens the project it made, with its edits.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createProject, getProject, updateProject } from '@/infrastructure/storage'
import { createProjectObject } from '@/features/projects/utils/project-helpers'
import { mediaLibraryService } from '@/features/media-library/services/media-library-service'
import { createLogger } from '@/shared/logging/logger'
import { linkProjectToPost, projectIdForPost } from '@/shared/alumi/links'
import {
  timelineFromSpec,
  type ImportedMedia,
  type StudioSpec,
} from '@/shared/alumi/timeline-from-spec'

const logger = createLogger('StudioOpen')

export const Route = createFileRoute('/studio')({
  validateSearch: (search: Record<string, unknown>) => ({
    post: typeof search.post === 'string' ? search.post : '',
  }),
  component: StudioOpen,
})

async function fetchSpec(origin: string, postId: string): Promise<StudioSpec> {
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
  return (await response.json()) as StudioSpec
}

function StudioOpen() {
  const { post } = Route.useSearch()
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
    void (async () => {
      try {
        // Reopen the project this post already has, with its edits.
        const existing = projectIdForPost(post)
        if (existing && (await getProject(existing))) {
          await navigate({
            to: '/editor/$projectId',
            params: { projectId: existing },
            replace: true,
          })
          return
        }
        const spec = await fetchSpec(origin, post)
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
        const imported = new Map<string, ImportedMedia>()
        const failed: string[] = []
        for (const [index, media] of spec.media.entries()) {
          setStatus(`Importing ${index + 1} of ${spec.media.length}: ${media.fileName}`)
          try {
            const meta = await mediaLibraryService.importMediaFromUrl(media.url, project.id)
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
            failed.push(media.fileName)
          }
        }
        setStatus('Laying out the timeline…')
        await updateProject(project.id, { timeline: timelineFromSpec(spec, imported) })
        if (failed.length) {
          logger.warn(`Opened without ${failed.length} file(s): ${failed.join(', ')}`)
        }
        await navigate({
          to: '/editor/$projectId',
          params: { projectId: project.id },
          replace: true,
        })
      } catch (err) {
        logger.error('Opening the post failed', err)
        setError(err instanceof Error ? err.message : 'Something went wrong opening the post.')
      }
    })()
  }, [navigate, post])

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
