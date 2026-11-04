/**
 * Studio AI (hosted in AlumiAI Studio only): make a clip, a picture or a voiceover with
 * the sub-account's Studio models and ElevenLabs voices, charged to its wallet, and put
 * the result straight into this project's media library. Clips and pictures run as jobs
 * on fal.ai: they're polled here and imported when done; the pending ones are remembered
 * per project, so closing the panel or reloading doesn't lose them.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Clapperboard, Image as ImageIcon, Loader2, Mic, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/shared/ui/cn'
import { usePlaybackStore } from '@/shared/state/playback'
import { setLinkMediaMap, studioLinkForProject, type StudioLink } from '@/shared/alumi/links'
import {
  formatQuote,
  loadStudioAiOptions,
  makeStudioVoiceover,
  pollStudioMedia,
  quoteStudioMedia,
  startStudioMedia,
  studioMediaFileUrl,
  type StudioAiModel,
  type StudioAiOptions,
} from '@/shared/alumi/studio-ai'
import {
  importMediaLibraryService,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library'
import { insertGeneratedAudioOnNewTrack } from '../utils/insert-generated-audio'

type Tab = 'video' | 'image' | 'voice'
type Job = {
  id: string
  label: string
  kind: 'video' | 'image'
  status: 'pending' | 'importing' | 'done' | 'failed'
  error?: string
}

const POLL_MS = 5000
const SELECT = 'h-8 w-full rounded-md border border-border bg-secondary/40 px-2 text-xs'
const jobsKey = (projectId: string) => `alumi-ai-jobs:${projectId}`

function readJobs(projectId: string): Job[] {
  try {
    const raw = localStorage.getItem(jobsKey(projectId))
    const jobs = raw ? (JSON.parse(raw) as Job[]) : []
    return Array.isArray(jobs) ? jobs.filter((j) => j && typeof j.id === 'string') : []
  } catch {
    return []
  }
}
function writeJobs(projectId: string, jobs: Job[]) {
  try {
    // Keep what's still running, and the last few finished ones for the list.
    const keep = [
      ...jobs.filter((j) => j.status === 'pending' || j.status === 'importing'),
      ...jobs.filter((j) => j.status === 'done' || j.status === 'failed').slice(0, 5),
    ]
    localStorage.setItem(jobsKey(projectId), JSON.stringify(keep))
  } catch {
    /* storage unavailable: jobs just aren't remembered */
  }
}

export const StudioAiSection = memo(function StudioAiSection({ projectId }: { projectId: string }) {
  const link = useMemo(() => studioLinkForProject(projectId), [projectId])
  if (!link) return null
  return <StudioAiPanel key={projectId} projectId={projectId} link={link} />
})

function StudioAiPanel({ projectId, link }: { projectId: string; link: StudioLink }) {
  const loadMediaItems = useMediaLibraryStore((s) => s.loadMediaItems)
  const selectMedia = useMediaLibraryStore((s) => s.selectMedia)
  const showNotification = useMediaLibraryStore((s) => s.showNotification)

  const [open, setOpen] = useState(true)
  const [options, setOptions] = useState<StudioAiOptions | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('video')
  const [modelKey, setModelKey] = useState<Record<'video' | 'image', string>>({
    video: '',
    image: '',
  })
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState('9:16')
  // The person's picks per model; each model starts on its own defaults.
  const [durationPick, setDurationPick] = useState<Record<string, number>>({})
  const [resolutionPick, setResolutionPick] = useState<Record<string, string>>({})
  const [sound, setSound] = useState(true)
  const [quote, setQuote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>(() => readJobs(projectId))
  const [voiceId, setVoiceId] = useState('')
  const [voiceModelId, setVoiceModelId] = useState('')
  const [script, setScript] = useState('')
  const inFlight = useRef(new Set<string>())

  useEffect(() => {
    let alive = true
    loadStudioAiOptions(link).then((r) => {
      if (!alive) return
      if (!r.ok) {
        setLoadError(r.error)
        return
      }
      setOptions(r)
      const first = (kind: 'video' | 'image') => r.models.find((m) => m.kind === kind)?.key ?? ''
      setModelKey({ video: first('video'), image: first('image') })
      setVoiceId(r.voices[0]?.voiceId ?? '')
      setVoiceModelId(r.voiceModels[0]?.id ?? '')
    })
    return () => {
      alive = false
    }
  }, [link])

  useEffect(() => {
    writeJobs(projectId, jobs)
  }, [projectId, jobs])

  const kind: 'video' | 'image' = tab === 'image' ? 'image' : 'video'
  const model: StudioAiModel | undefined = options?.models.find((m) => m.key === modelKey[kind])

  const duration = model ? (durationPick[model.key] ?? model.durations?.default) : undefined
  const resolution = model
    ? (resolutionPick[model.key] ?? model.defaultResolution ?? model.resolutions?.[0] ?? undefined)
    : undefined
  const setDuration = (v: number) => {
    if (model) setDurationPick((p) => ({ ...p, [model.key]: v }))
  }
  const setResolution = (v: string) => {
    if (model) setResolutionPick((p) => ({ ...p, [model.key]: v }))
  }

  // The price, a moment after the settings stop changing.
  useEffect(() => {
    if (!model || tab === 'voice') return
    let alive = true
    const t = setTimeout(() => {
      quoteStudioMedia(link, {
        modelKey: model.key,
        aspectRatio: aspect,
        durationSeconds: duration,
        resolution,
        sound: model.sound ? sound : undefined,
      }).then((r) => {
        if (alive) setQuote(r.ok ? formatQuote(r) : '')
      })
    }, 400)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [link, model, tab, aspect, duration, resolution, sound])

  const update = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }, [])

  /** Import a finished Studio file into this project's library; returns the editor's media. */
  const importFile = useCallback(
    async (studioId: string) => {
      const { mediaLibraryService } = await importMediaLibraryService()
      const media = await mediaLibraryService.importMediaFromUrl(
        studioMediaFileUrl(link, studioId),
        projectId,
      )
      // Studio already has this file: record the pair so syncing doesn't upload it back.
      const current = studioLinkForProject(projectId)
      setLinkMediaMap(projectId, { ...(current?.mediaMap ?? {}), [studioId]: media.id })
      await loadMediaItems()
      selectMedia([media.id])
      return media
    },
    [link, projectId, loadMediaItems, selectMedia],
  )

  // Poll running jobs; import each one when it's ready.
  const pending = jobs
    .filter((j) => j.status === 'pending')
    .map((j) => j.id)
    .join(',')
  useEffect(() => {
    if (!pending) return
    let alive = true
    const tick = async () => {
      for (const id of pending.split(',')) {
        if (!alive || inFlight.current.has(id)) continue
        inFlight.current.add(id)
        try {
          const r = await pollStudioMedia(link, id)
          if (!alive || !r.ok) continue
          if (r.media.status === 'failed') {
            update(id, {
              status: 'failed',
              error: r.media.error || 'It couldn’t be made. Nothing was charged.',
            })
          } else if (r.media.status === 'ready') {
            update(id, { status: 'importing' })
            try {
              const media = await importFile(id)
              update(id, { status: 'done' })
              showNotification({
                type: 'success',
                message: `${media.fileName} is in your media. Drag it onto the timeline.`,
              })
            } catch (err) {
              update(id, {
                status: 'failed',
                error:
                  err instanceof Error
                    ? err.message
                    : 'It was made, but couldn’t be added here. It’s in Studio’s media.',
              })
            }
          }
        } finally {
          inFlight.current.delete(id)
        }
      }
    }
    void tick()
    const t = setInterval(() => void tick(), POLL_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [pending, link, update, importFile, showNotification])

  const generate = async () => {
    if (!model) return
    setBusy(true)
    setError(null)
    try {
      const r = await startStudioMedia(link, {
        modelKey: model.key,
        prompt,
        aspectRatio: aspect,
        durationSeconds: duration,
        resolution,
        sound: model.sound ? sound : undefined,
      })
      if (!r.ok) {
        setError(r.error)
        return
      }
      setJobs((js) => [
        { id: r.media.id, label: prompt.trim().slice(0, 60), kind, status: 'pending' },
        ...js,
      ])
    } finally {
      setBusy(false)
    }
  }

  const speak = async () => {
    setBusy(true)
    setError(null)
    // Capture where to put it when they click, not when it's done.
    const insertionFrame = usePlaybackStore.getState().currentFrame
    try {
      const r = await makeStudioVoiceover(link, { voiceId, modelId: voiceModelId, text: script })
      if (!r.ok) {
        setError(r.error)
        return
      }
      const media = await importFile(r.media.id)
      const { mediaLibraryService } = await importMediaLibraryService()
      const blobUrl = await mediaLibraryService.getMediaBlobUrl(media.id)
      const inserted = blobUrl
        ? insertGeneratedAudioOnNewTrack(media, blobUrl, insertionFrame)
        : false
      showNotification({
        type: 'success',
        message: inserted
          ? `Voiceover added at the playhead.`
          : `${media.fileName} is in your media.`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The voiceover couldn’t be added. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const voiceModel = options?.voiceModels.find((m) => m.id === voiceModelId)
  const models = options?.models.filter((m) => m.kind === kind) ?? []
  const lengths = model?.durations
    ? (model.durations.values ??
      Array.from(
        { length: model.durations.max - model.durations.min + 1 },
        (_, i) => model.durations!.min + i,
      ))
    : []

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="-mx-3 -mt-3 bg-secondary/50 px-3 py-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-label={open ? 'Collapse Studio AI' : 'Expand Studio AI'}
          >
            <h2 className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Studio AI
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

      <CollapsibleContent className="space-y-3 pt-3">
        {loadError ? (
          <p className="text-xs text-destructive">{loadError}</p>
        ) : !options ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border text-xs">
              {(
                [
                  ['video', 'Clip', Clapperboard],
                  ['image', 'Picture', ImageIcon],
                  ['voice', 'Voiceover', Mic],
                ] as const
              ).map(([t, label, Icon]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTab(t)
                    setError(null)
                  }}
                  className={cn(
                    'flex items-center justify-center gap-1 py-1.5',
                    tab === t
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-3 w-3" /> {label}
                </button>
              ))}
            </div>

            {tab !== 'voice' ? (
              !options.ready ? (
                <p className="text-xs text-muted-foreground">
                  Clip and picture generation isn’t switched on for Studio yet.
                </p>
              ) : (
                <div className="space-y-2.5">
                  <div className="space-y-1">
                    <Label className="text-xs">Model</Label>
                    <select
                      className={SELECT}
                      value={modelKey[kind]}
                      onChange={(e) => setModelKey((m) => ({ ...m, [kind]: e.target.value }))}
                      aria-label="Model"
                    >
                      {models.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                          {m.priceLabel ? ` · ${m.priceLabel}` : ''}
                        </option>
                      ))}
                    </select>
                    {model && <p className="text-[11px] text-muted-foreground">{model.bestFor}</p>}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Prompt</Label>
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      rows={4}
                      className="text-xs"
                      placeholder={
                        kind === 'video'
                          ? 'What happens in the clip: the subject, the action, the setting, the camera, the light.'
                          : 'The picture: subject, setting, style, light. Leave out text; add words with a text layer.'
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Shape</Label>
                      <select
                        className={SELECT}
                        value={aspect}
                        onChange={(e) => setAspect(e.target.value)}
                        aria-label="Shape"
                      >
                        {options.aspects.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </div>
                    {lengths.length > 0 && (
                      <div className="space-y-1">
                        <Label className="text-xs">Length</Label>
                        <select
                          className={SELECT}
                          value={duration ?? ''}
                          onChange={(e) => setDuration(Number(e.target.value))}
                          aria-label="Length"
                        >
                          {lengths.map((s) => (
                            <option key={s} value={s}>
                              {s}s
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {model?.resolutions && model.resolutions.length > 1 && (
                      <div className="space-y-1">
                        <Label className="text-xs">Quality</Label>
                        <select
                          className={SELECT}
                          value={resolution ?? ''}
                          onChange={(e) => setResolution(e.target.value)}
                          aria-label="Quality"
                        >
                          {model.resolutions.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  {model?.sound && (
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={sound}
                        onChange={(e) => setSound(e.target.checked)}
                      />{' '}
                      With sound
                    </label>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={busy || prompt.trim().length < 5 || !model}
                      onClick={() => void generate()}
                    >
                      {busy ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                      )}
                      Make {kind === 'video' ? 'clip' : 'picture'}
                    </Button>
                    {quote && model && (
                      <span className="text-[11px] text-muted-foreground">{quote}</span>
                    )}
                  </div>
                </div>
              )
            ) : !options.voiceReady ? (
              <p className="text-xs text-muted-foreground">
                Voiceovers aren’t switched on for Studio yet.
              </p>
            ) : options.voices.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                This sub-account has no voices yet. Add some in Studio under Voice Library.
              </p>
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Voice</Label>
                    <select
                      className={SELECT}
                      value={voiceId}
                      onChange={(e) => setVoiceId(e.target.value)}
                      aria-label="Voice"
                    >
                      {options.voices.map((v) => (
                        <option key={v.voiceId} value={v.voiceId}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Style</Label>
                    <select
                      className={SELECT}
                      value={voiceModelId}
                      onChange={(e) => setVoiceModelId(e.target.value)}
                      aria-label="Voice style"
                    >
                      {options.voiceModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Script</Label>
                  <Textarea
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    rows={5}
                    className="text-xs"
                    placeholder="What the voice says. Write it the way it should be heard."
                  />
                  {voiceModel && (
                    <p className="text-[11px] text-muted-foreground">
                      {script.length.toLocaleString()} / {voiceModel.maxChars.toLocaleString()}{' '}
                      characters · goes on a new audio track at the playhead
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  disabled={busy || script.trim().length < 2 || !voiceId}
                  onClick={() => void speak()}
                >
                  {busy ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Mic className="mr-1 h-3.5 w-3.5" />
                  )}{' '}
                  Make voiceover
                </Button>
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            {jobs.length > 0 && tab !== 'voice' && (
              <div className="space-y-1.5 border-t border-border pt-2">
                {jobs.map((j) => (
                  <div key={j.id} className="flex items-start gap-2 text-xs">
                    {j.status === 'pending' || j.status === 'importing' ? (
                      <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                    ) : j.kind === 'video' ? (
                      <Clapperboard className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ImageIcon className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate">
                        {j.label || (j.kind === 'video' ? 'Clip' : 'Picture')}
                      </p>
                      <p
                        className={cn(
                          'text-[11px]',
                          j.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {j.status === 'pending'
                          ? 'Making… you can keep editing'
                          : j.status === 'importing'
                            ? 'Adding to your media…'
                            : j.status === 'done'
                              ? 'In your media'
                              : j.error}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Charged to the sub-account’s wallet{options.free ? ' (free for this one)' : ''}, like
              everything made in Creative Studio. Everything made here is also kept in Studio.
            </p>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
