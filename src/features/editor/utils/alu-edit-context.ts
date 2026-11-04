/**
 * What Edit with Alu is shown: a compact description of the open timeline (tracks,
 * items, transitions, keyframed properties, the media library, and what's said in each
 * clip, placed on the timeline), and the catalogue of effects and transitions this editor
 * build has. Times are timeline frames; the AI answers with the editor's own ops.
 */

import type { MediaMetadata, MediaTranscript } from '@/types/storage'
import type { TimelineItem } from '@/types/timeline'
import { GPU_EFFECT_REGISTRY } from '@/infrastructure/gpu-effects'
import { transitionRegistry } from '@/shared/timeline/transitions'
import type { captureSnapshot } from '@/features/editor/deps/timeline-store'

type Snapshot = ReturnType<typeof captureSnapshot>

const MAX_ITEMS = 400
const MAX_WORDS = 4000

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places

/** A transcript's words that play in this item, as [text, startFrame, endFrame] on the timeline. */
export function wordsOnTimeline(
  item: TimelineItem,
  transcript: MediaTranscript,
  fps: number,
): [string, number, number][] {
  if (item.isReversed) return []
  const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps
  const speed = item.speed && item.speed > 0 ? item.speed : 1
  const sourceStart = item.sourceStart ?? 0
  // Source frames this item plays: durationInFrames timeline frames at `speed`.
  const sourceEnd = sourceStart + (item.durationInFrames * speed * sourceFps) / fps
  const toTimeline = (seconds: number) =>
    Math.round(item.from + (((seconds * sourceFps - sourceStart) / speed) * fps) / sourceFps)
  const out: [string, number, number][] = []
  for (const segment of transcript.segments) {
    const words = segment.words?.length
      ? segment.words
      : [{ text: segment.text, start: segment.start, end: segment.end }]
    for (const w of words) {
      const s = w.start * sourceFps
      if (s < sourceStart || s >= sourceEnd) continue
      const text = w.text.trim()
      if (text) out.push([text, toTimeline(w.start), toTimeline(w.end)])
    }
  }
  return out
}

function describeItem(item: TimelineItem, keyframed: string[]) {
  const base: Record<string, unknown> = {
    id: item.id,
    type: item.type,
    trackId: item.trackId,
    from: item.from,
    durationInFrames: item.durationInFrames,
    label: item.label,
  }
  if (item.mediaId) base.mediaId = item.mediaId
  if (item.linkedGroupId) base.linkedGroupId = item.linkedGroupId
  if (item.speed !== undefined && item.speed !== 1) base.speed = item.speed
  if (item.volume !== undefined && item.volume !== 0) base.volume = item.volume
  if (item.sourceStart && item.sourceFps)
    base.sourceStartSec = round(item.sourceStart / item.sourceFps)
  if (item.type === 'text') {
    base.text = item.text
    if (item.fontSize !== undefined) base.fontSize = item.fontSize
    if (item.color) base.color = item.color
    if (item.fontFamily) base.fontFamily = item.fontFamily
    if (item.textRole === 'caption') base.caption = true
  }
  if (item.type === 'shape') base.shapeType = item.shapeType
  if (item.transform) {
    const { x, y, width, height, rotation, opacity } = item.transform
    const t = Object.fromEntries(
      Object.entries({ x, y, width, height, rotation, opacity })
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]),
    )
    if (Object.keys(t).length) base.transform = t
  }
  if (item.effects?.length) {
    base.effects = item.effects.map((e) => ({
      id: e.id,
      gpuEffectType: e.effect.gpuEffectType,
      ...(e.enabled ? {} : { enabled: false }),
      params: e.effect.params,
    }))
  }
  if (item.fadeIn) base.fadeIn = item.fadeIn
  if (item.fadeOut) base.fadeOut = item.fadeOut
  if (keyframed.length) base.keyframed = keyframed
  return base
}

export type TimelineContext = {
  snapshot: Snapshot
  media: MediaMetadata[]
  transcripts: Record<string, MediaTranscript>
  selectedItemIds: string[]
}

/** The timeline as Alu reads it (JSON text). */
export function describeTimeline({
  snapshot,
  media,
  transcripts,
  selectedItemIds,
}: TimelineContext): string {
  const fps = snapshot.projectMetadata?.fps ?? snapshot.fps ?? 30
  const items = [...snapshot.items].sort((a, b) => a.from - b.from)
  const keyframedBy = new Map<string, string[]>()
  for (const k of snapshot.keyframes) {
    const props = [
      ...k.properties.filter((p) => p.keyframes.length).map((p) => p.property),
      ...(k.vectorProperties ?? []).filter((p) => p.keyframes.length).map((p) => p.property),
    ]
    if (props.length) keyframedBy.set(k.itemId, props.map(String))
  }
  const end = items.reduce((m, i) => Math.max(m, i.from + i.durationInFrames), 0)

  let wordBudget = MAX_WORDS
  const speech: { itemId: string; words: [string, number, number][] }[] = []
  for (const item of items) {
    if (wordBudget <= 0) break
    if ((item.type !== 'video' && item.type !== 'audio') || !item.mediaId) continue
    // A video and its linked audio say the same thing: describe it once, on the video.
    if (
      item.type === 'audio' &&
      item.linkedGroupId &&
      items.some((o) => o.type === 'video' && o.linkedGroupId === item.linkedGroupId)
    )
      continue
    const transcript = transcripts[item.mediaId]
    if (!transcript) continue
    const words = wordsOnTimeline(item, transcript, fps).slice(0, wordBudget)
    wordBudget -= words.length
    if (words.length) speech.push({ itemId: item.id, words })
  }

  return JSON.stringify({
    fps,
    width: snapshot.projectMetadata?.width,
    height: snapshot.projectMetadata?.height,
    endFrame: end,
    playheadFrame: snapshot.currentFrame,
    selectedItemIds,
    tracks: [...snapshot.tracks]
      .sort((a, b) => a.order - b.order)
      .map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind ?? 'video',
        order: t.order,
        ...(t.isGroup ? { group: true } : {}),
        ...(t.visible === false ? { hidden: true } : {}),
        ...(t.muted ? { muted: true } : {}),
        ...(t.locked ? { locked: true } : {}),
      })),
    items: items.slice(0, MAX_ITEMS).map((i) => describeItem(i, keyframedBy.get(i.id) ?? [])),
    ...(items.length > MAX_ITEMS ? { itemsLeftOut: items.length - MAX_ITEMS } : {}),
    transitions: snapshot.transitions.map((t) => ({
      id: t.id,
      leftClipId: t.leftClipId,
      rightClipId: t.rightClipId,
      presentation: t.presentation,
      durationInFrames: t.durationInFrames,
      ...(t.direction ? { direction: t.direction } : {}),
    })),
    media: media.map((m) => ({
      mediaId: m.id,
      fileName: m.fileName,
      type: m.mimeType.split('/')[0],
      ...(m.duration ? { durationSec: round(m.duration) } : {}),
      ...(m.width && m.height ? { width: m.width, height: m.height } : {}),
    })),
    speech,
    ...(wordBudget <= 0 ? { speechCutShort: true } : {}),
  })
}

/** Effects and transitions this build has (JSON text): the same for every request, so Studio caches it. */
export function describeCatalog(): string {
  const effects = [...GPU_EFFECT_REGISTRY.values()].map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    params: Object.fromEntries(
      Object.entries(d.params)
        .filter(([, p]) => p.type !== 'json' && p.type !== 'point')
        .map(([key, p]) => [
          key,
          {
            type: p.type,
            label: p.label,
            default: p.default,
            ...(p.min !== undefined ? { min: p.min } : {}),
            ...(p.max !== undefined ? { max: p.max } : {}),
            ...(p.options ? { options: p.options.map((o) => o.value) } : {}),
          },
        ]),
    ),
  }))
  const transitions = transitionRegistry.getDefinitions().map((d) => ({
    presentation: d.id,
    name: d.label,
    ...(d.hasDirection && d.directions?.length ? { directions: d.directions } : {}),
    defaultDuration: d.defaultDuration,
    minDuration: d.minDuration,
    maxDuration: d.maxDuration,
  }))
  return JSON.stringify({ effects, transitions })
}
