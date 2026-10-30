/**
 * An AlumiAI Studio post's plan as an editor timeline.
 *
 * Studio describes the post as a sequence in seconds (its GET
 * /api/creative/editor/<post>); once the media is imported and measured this
 * turns it into tracks and items in frames. Pure: no stores, no storage.
 */

import type { ProjectTimeline } from '@/types/project'
import { DEFAULT_TRACK_HEIGHT } from '@/shared/timeline/defaults'

export interface StudioSpec {
  post: {
    id: string
    workspaceId: string
    name: string
    width: number
    height: number
    fps: number
  }
  media: { id: string; url: string; fileName: string; mimeType: string }[]
  sequence: (
    | { kind: 'media'; pieceId: string; mediaId: string; label: string; seconds: number }
    | { kind: 'text'; pieceId: string; label: string; text: string; seconds: number }
  )[]
  under: { pieceId: string; mediaId: string; label: string }[]
  captions: string[]
  style: { background: string; text: string; accent: string; headingFont: string }
}

/** What the import measured, per Studio media id. */
export interface ImportedMedia {
  /** The editor's own media id. */
  id: string
  mimeType: string
  duration: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
}

type Track = ProjectTimeline['tracks'][number]
type Item = ProjectTimeline['items'][number]

const DEFAULT_STILL_SECONDS = 3
const MIN_CAPTION_SECONDS = 1

function track(name: string, kind: 'video' | 'audio', order: number): Track {
  return {
    id: `track-${crypto.randomUUID()}`,
    name,
    kind,
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order,
  }
}

function sourceFields(media: ImportedMedia, projectFps: number) {
  const sourceFps = media.fps > 0 ? media.fps : projectFps
  const sourceEnd = Math.max(1, Math.round(media.duration * sourceFps))
  return { sourceFps, sourceStart: 0, sourceEnd, sourceDuration: sourceEnd, speed: 1 }
}

export function timelineFromSpec(
  spec: StudioSpec,
  imported: Map<string, ImportedMedia>,
): ProjectTimeline {
  const fps = spec.post.fps
  const frames = (seconds: number) => Math.max(1, Math.round(seconds * fps))
  // Captions above the picture; the sequence on V1; its sound on A1; voiceovers on A2.
  const captionsTrack = track('Captions', 'video', -1)
  const video = track('V1', 'video', 0)
  const audio = track('A1', 'audio', 1)
  const voice = track('A2', 'audio', 2)
  const items: Item[] = []
  let from = 0

  for (const entry of spec.sequence) {
    if (entry.kind === 'text') {
      const durationInFrames = frames(entry.seconds || DEFAULT_STILL_SECONDS)
      items.push({
        id: crypto.randomUUID(),
        type: 'text',
        trackId: video.id,
        from,
        durationInFrames,
        label: entry.label,
        text: entry.text,
        color: spec.style.text,
        fontSize: 72,
        fontFamily: spec.style.headingFont,
        fontWeight: 'bold',
        textAlign: 'center',
        verticalAlign: 'middle',
      })
      from += durationInFrames
      continue
    }
    const media = imported.get(entry.mediaId)
    if (!media) continue
    const isImage = media.mimeType.startsWith('image/')
    const isAudio = media.mimeType.startsWith('audio/')
    const seconds =
      entry.seconds > 0 ? entry.seconds : isImage ? DEFAULT_STILL_SECONDS : media.duration
    const durationInFrames = frames(seconds)
    if (isImage) {
      items.push({
        id: crypto.randomUUID(),
        type: 'image',
        trackId: video.id,
        from,
        durationInFrames,
        label: entry.label,
        mediaId: media.id,
        src: '',
        sourceWidth: media.width,
        sourceHeight: media.height,
      })
    } else if (isAudio) {
      items.push({
        id: crypto.randomUUID(),
        type: 'audio',
        trackId: audio.id,
        from,
        durationInFrames,
        label: entry.label,
        mediaId: media.id,
        src: '',
        volume: 0,
        ...sourceFields(media, fps),
      })
    } else {
      const linkedGroupId = crypto.randomUUID()
      const sf = sourceFields(media, fps)
      items.push({
        id: crypto.randomUUID(),
        type: 'video',
        trackId: video.id,
        from,
        durationInFrames,
        label: entry.label,
        mediaId: media.id,
        src: '',
        volume: 0,
        linkedGroupId,
        sourceWidth: media.width,
        sourceHeight: media.height,
        ...sf,
      })
      if (media.hasAudio) {
        items.push({
          id: crypto.randomUUID(),
          type: 'audio',
          trackId: audio.id,
          from,
          durationInFrames,
          label: `${entry.label} audio`,
          mediaId: media.id,
          src: '',
          volume: 0,
          linkedGroupId,
          ...sf,
        })
      }
    }
    from += durationInFrames
  }

  let total = from
  for (const entry of spec.under) {
    const media = imported.get(entry.mediaId)
    if (!media || !media.mimeType.startsWith('audio/')) continue
    const durationInFrames = frames(media.duration)
    items.push({
      id: crypto.randomUUID(),
      type: 'audio',
      trackId: voice.id,
      from: 0,
      durationInFrames,
      label: entry.label,
      mediaId: media.id,
      src: '',
      volume: 0,
      ...sourceFields(media, fps),
    })
    total = Math.max(total, durationInFrames)
  }

  // Caption lines spread evenly over the video; the person times them to the speech.
  if (spec.captions.length && total > 0) {
    const each = Math.max(frames(MIN_CAPTION_SECONDS), Math.floor(total / spec.captions.length))
    spec.captions.forEach((text, i) => {
      const start = i * each
      if (start >= total) return
      items.push({
        id: crypto.randomUUID(),
        type: 'text',
        trackId: captionsTrack.id,
        from: start,
        durationInFrames: Math.min(each, total - start),
        label: `Caption ${i + 1}`,
        text,
        color: spec.style.text,
        fontSize: 56,
        fontFamily: spec.style.headingFont,
        fontWeight: 'bold',
        textAlign: 'center',
        verticalAlign: 'bottom',
      })
    })
  }

  const tracks = [captionsTrack, video, audio, voice].filter(
    (t) => t === video || items.some((i) => i.trackId === t.id),
  )
  return { tracks, items }
}
