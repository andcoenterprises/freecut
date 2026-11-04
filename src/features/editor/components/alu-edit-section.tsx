/**
 * Edit with Alu (hosted in AlumiAI Studio only): say what to change and Alu makes the
 * edit on the open timeline, as one step that Undo takes back. Studio's AI plans the edit
 * in the editor's own ops; when the edit changes how things look, Alu then looks at a few
 * rendered frames and fixes what's off. Each request is charged to the sub-account's
 * wallet at what the AI actually used.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Loader2, Undo2, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/shared/ui/cn'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { useSelectionStore } from '@/shared/state/selection'
import { studioLinkForProject, type StudioLink } from '@/shared/alumi/links'
import { askAlu, formatMoney, loadAluOptions, type AluMoney } from '@/shared/alumi/studio-ai'
import { useMediaLibraryStore } from '@/features/editor/deps/media-library'
import { captureSnapshot, useTimelineCommandStore } from '@/features/editor/deps/timeline-store'
import { transcriptCaptions } from '@/features/editor/deps/alu-edit'
import type { MediaTranscript } from '@/types/storage'
import { describeCatalog, describeTimeline } from '../utils/alu-edit-context'
import { ALU_COMMAND, applyAluOps, runAluActions, undoAlu } from '../utils/alu-edit-apply'

type Stage = 'reading' | 'planning' | 'applying' | 'actions' | 'checking' | 'fixing'
const STAGE_TEXT: Record<Stage, string> = {
  reading: 'Reading the timeline…',
  planning: 'Planning the edit…',
  applying: 'Making the edit…',
  actions: 'Transcribing and finding what to cut…',
  checking: 'Looking at the result…',
  fixing: 'Fixing what looked off…',
}

type Result = {
  id: string
  request: string
  summary: string[]
  notes: string[]
  charged: AluMoney | null
  token: string | null
  error?: string
}

const EXAMPLES = [
  'Add a short crossfade between every clip',
  'Put “Book today” in the lower third for the last 3 seconds',
  'Add captions',
  'Cut the pauses',
  'Give every clip a warm, slightly faded film look',
]

const FRAME_LONG_SIDE = 768

async function waitForFrame(frame: number, ms = 2500) {
  const start = performance.now()
  while (performance.now() - start < ms) {
    if (usePreviewBridgeStore.getState().displayedFrame === frame) return
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** JPEG frames of the timeline at these frames, for the check pass. The playhead goes back where it was. */
async function captureFrames(frames: number[], width: number, height: number) {
  const playback = usePlaybackStore.getState()
  const capture = usePreviewBridgeStore.getState().captureFrame
  if (!capture) return []
  const back = playback.currentFrame
  if (playback.isPlaying) playback.pause()
  const scale = Math.min(1, FRAME_LONG_SIDE / Math.max(width, height))
  const out: { frame: number; jpegBase64: string }[] = []
  try {
    for (const frame of [...new Set(frames.map((f) => Math.max(0, Math.round(f))))].slice(0, 4)) {
      usePlaybackStore.getState().setCurrentFrame(frame)
      await waitForFrame(frame)
      const url = await capture({
        format: 'image/jpeg',
        quality: 0.8,
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        fresh: true,
      })
      const base64 = url?.split(',')[1]
      if (base64) out.push({ frame, jpegBase64: base64 })
    }
  } finally {
    usePlaybackStore.getState().setCurrentFrame(back)
  }
  return out
}

/** What's said in each clip on the timeline (only transcripts already made). */
async function transcriptsOnTimeline(mediaIds: string[]) {
  const out: Record<string, MediaTranscript> = {}
  await Promise.all(
    mediaIds.map(async (id) => {
      const t = await transcriptCaptions.getTranscript(id).catch(() => null)
      if (t) out[id] = t
    }),
  )
  return out
}

function addMoney(a: AluMoney | null, b: AluMoney): AluMoney {
  return a && a.currency === b.currency ? { amount: a.amount + b.amount, currency: a.currency } : b
}

export const AluEditSection = memo(function AluEditSection({ projectId }: { projectId: string }) {
  const link = useMemo(() => studioLinkForProject(projectId), [projectId])
  if (!link) return null
  return <AluEditPanel key={projectId} link={link} />
})

function AluEditPanel({ link }: { link: StudioLink }) {
  const [open, setOpen] = useState(true)
  const [ready, setReady] = useState<boolean | null>(null)
  const [price, setPrice] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [request, setRequest] = useState('')
  const [check, setCheck] = useState(true)
  const [stage, setStage] = useState<Stage | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const latestUndo = useTimelineCommandStore((s) => {
    const top = s.undoStack.at(-1)
    return top?.command.type === ALU_COMMAND ? String(top.command.payload?.token ?? '') : ''
  })
  const catalog = useMemo(() => describeCatalog(), [])

  useEffect(() => {
    let alive = true
    loadAluOptions(link).then((r) => {
      if (!alive) return
      if (!r.ok) {
        setLoadError(r.error)
        return
      }
      setReady(r.ready)
      const e = r.estimate
      setPrice(!e ? '' : e.free ? 'Free for this sub-account' : `About ${formatMoney(e)} a request`)
    })
    return () => {
      alive = false
    }
  }, [link])

  const run = useCallback(async () => {
    const asked = request.trim()
    if (asked.length < 2 || stage) return
    const id = crypto.randomUUID()
    const result: Result = {
      id,
      request: asked,
      summary: [],
      notes: [],
      charged: null,
      token: null,
    }
    const finish = (patch: Partial<Result>) => {
      setResults((rs) => [{ ...result, ...patch }, ...rs].slice(0, 6))
      setStage(null)
    }
    try {
      setStage('reading')
      const read = async () => {
        const snapshot = captureSnapshot()
        const mediaIds = [
          ...new Set(
            snapshot.items
              .filter((i) => (i.type === 'video' || i.type === 'audio') && i.mediaId)
              .map((i) => i.mediaId!),
          ),
        ]
        return {
          snapshot,
          timeline: describeTimeline({
            snapshot,
            media: useMediaLibraryStore.getState().mediaItems,
            transcripts: await transcriptsOnTimeline(mediaIds),
            selectedItemIds: useSelectionStore.getState().selectedItemIds,
          }),
        }
      }
      const first = await read()

      setStage('planning')
      const planned = await askAlu(link, { request: asked, timeline: first.timeline, catalog })
      if (!planned.ok) return finish({ error: planned.error })
      result.charged = planned.charged
      result.summary = [...planned.plan.summary]
      result.notes = [...planned.plan.notes]

      setStage('applying')
      let applied
      try {
        applied = applyAluOps(planned.plan.ops)
      } catch (error) {
        return finish({
          error: `Alu’s edit didn’t fit this timeline, so nothing was changed. Try again, or say it another way. (${error instanceof Error ? error.message : String(error)})`,
        })
      }
      if (applied.applied > 0) result.token = applied.token

      if (applied.actions.length) {
        setStage('actions')
        result.summary.push(...(await runAluActions(applied.actions)))
      }

      const frames = planned.plan.checkFrames
      if (check && applied.applied > 0 && frames.length) {
        setStage('checking')
        const meta = first.snapshot.projectMetadata
        const shots = await captureFrames(frames, meta?.width ?? 1920, meta?.height ?? 1080)
        if (shots.length) {
          const now = await read()
          const reviewed = await askAlu(link, {
            request: asked,
            timeline: now.timeline,
            catalog,
            review: { plan: planned.plan.summary.join('\n'), frames: shots },
          })
          if (reviewed.ok) {
            result.charged = addMoney(result.charged, reviewed.charged)
            if (reviewed.plan.ops.length) {
              setStage('fixing')
              try {
                applyAluOps(reviewed.plan.ops, applied)
                result.summary.push(...reviewed.plan.summary.map((s) => `Fixed: ${s}`))
              } catch {
                result.notes.push(
                  'The check found something to fix, but the fix didn’t fit; the edit is as first made.',
                )
              }
            }
            result.notes.push(...reviewed.plan.notes)
          } else {
            result.notes.push(`The edit is made, but it couldn’t be checked: ${reviewed.error}`)
          }
        }
      }
      if (!result.summary.length && !result.notes.length)
        result.notes.push('Alu didn’t find anything to change.')
      finish({})
      setRequest('')
    } catch (error) {
      finish({ error: error instanceof Error ? error.message : 'Something went wrong. Try again.' })
    }
  }, [request, stage, link, catalog, check])

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="-mx-3 -mt-3 bg-secondary/50 px-3 py-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-label={open ? 'Collapse Edit with Alu' : 'Expand Edit with Alu'}
          >
            <h2 className="flex items-center gap-1.5 text-sm font-medium">
              <WandSparkles className="h-3.5 w-3.5 text-primary" /> Edit with Alu
            </h2>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                open && 'rotate-180',
              )}
            />
          </button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="space-y-2 pt-3">
        {loadError ? (
          <p className="text-xs text-destructive">{loadError}</p>
        ) : ready === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !ready ? (
          <p className="text-xs text-muted-foreground">
            Alu isn’t switched on yet: a platform admin needs to add the AI key in Studio.
          </p>
        ) : (
          <>
            <Textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run()
              }}
              placeholder="Tell Alu what to change, e.g. trim the first clip to 3 seconds and fade in the title"
              className="min-h-[72px] text-xs"
              maxLength={2000}
              disabled={!!stage}
              aria-label="What Alu should change"
            />
            {!request && !stage && (
              <div className="flex flex-wrap gap-1">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setRequest(ex)}
                    className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={check}
                onChange={(e) => setCheck(e.target.checked)}
                disabled={!!stage}
              />
              Look at the result and fix what’s off
            </label>
            <Button
              size="sm"
              className="w-full"
              onClick={() => void run()}
              disabled={!!stage || request.trim().length < 2}
            >
              {stage ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {STAGE_TEXT[stage]}
                </>
              ) : (
                'Edit with Alu'
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              {price ? `${price}, charged to the sub-account’s wallet. ` : ''}Undo takes the whole
              edit back.
            </p>

            {results.map((r) => (
              <div key={r.id} className="space-y-1 rounded-md border border-border p-2 text-xs">
                <p className="font-medium">{r.request}</p>
                {r.error ? (
                  <p className="text-destructive">{r.error}</p>
                ) : (
                  <>
                    {r.summary.length > 0 && (
                      <ul className="list-disc space-y-0.5 pl-4">
                        {r.summary.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    )}
                    {r.notes.map((n, i) => (
                      <p key={i} className="text-muted-foreground">
                        {n}
                      </p>
                    ))}
                  </>
                )}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="text-[11px] text-muted-foreground">
                    {r.charged && r.charged.amount > 0 ? `Charged ${formatMoney(r.charged)}` : ''}
                  </span>
                  {r.token && r.token === latestUndo && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => undoAlu(r.token!)}
                    >
                      <Undo2 className="mr-1 h-3 w-3" /> Undo
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
