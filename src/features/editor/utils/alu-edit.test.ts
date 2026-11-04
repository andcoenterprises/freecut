import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { MediaTranscript } from '@/types/storage'
import type { TextItem, VideoItem } from '@/types/timeline'
import { GPU_EFFECT_REGISTRY, getGpuEffectDefaultParams } from '@/infrastructure/gpu-effects'
import {
  makeTimelineTrack,
  resetTimelineCompositionTestState,
  setTimelineState,
} from '@/features/editor/deps/timeline-test-helpers-contract'
import {
  captureSnapshot,
  useItemsStore,
  useTimelineCommandStore,
} from '@/features/editor/deps/timeline-store'
import { ALU_COMMAND, applyAluOps, toEditOp, undoAlu } from './alu-edit-apply'
import { describeCatalog, describeTimeline, wordsOnTimeline } from './alu-edit-context'

const video = (over: Partial<VideoItem> = {}): VideoItem => ({
  id: 'v1',
  type: 'video',
  trackId: 'tv',
  from: 0,
  durationInFrames: 90,
  label: 'shot.mp4',
  src: '',
  mediaId: 'm1',
  sourceStart: 0,
  sourceEnd: 90,
  sourceDuration: 300,
  sourceFps: 30,
  ...over,
})

const text = (over: Partial<TextItem> = {}): TextItem =>
  ({
    id: 'title',
    type: 'text',
    trackId: 'tt',
    from: 0,
    durationInFrames: 60,
    label: 'Title',
    text: 'Hello',
    color: '#ffffff',
    fontSize: 80,
    ...over,
  }) as TextItem

const transcript = (words: [string, number, number][]): MediaTranscript =>
  ({
    id: 'm1',
    mediaId: 'm1',
    model: 'whisper-tiny',
    quantization: 'q8',
    text: words.map((w) => w[0]).join(' '),
    segments: [
      {
        text: '',
        start: 0,
        end: 99,
        words: words.map(([t, start, end]) => ({ text: t, start, end })),
      },
    ],
    createdAt: 0,
    updatedAt: 0,
  }) as MediaTranscript

function seed() {
  resetTimelineCompositionTestState()
  setTimelineState({
    fps: 30,
    tracks: [
      makeTimelineTrack({ id: 'tt', name: 'Titles', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'tv', name: 'V1', kind: 'video', order: 1 }),
    ],
    items: [video(), video({ id: 'v2', from: 90 }), text()],
  })
  useTimelineCommandStore.getState().clearHistory()
}

const fromOf = (id: string) => useItemsStore.getState().itemById[id]?.from

describe('Edit with Alu: what Alu reads', () => {
  it('places a clip’s words on the timeline, skipping what the clip doesn’t play', () => {
    // Plays source 2 s..5 s (sourceStart 60 at 30 fps, 90 frames) from timeline frame 30.
    const item = video({ from: 30, sourceStart: 60 })
    const words = wordsOnTimeline(
      item,
      transcript([
        ['before', 1.5, 1.9],
        ['hello', 2.5, 3],
        ['there', 4, 4.5],
        ['after', 5.2, 5.6],
      ]),
      30,
    )
    expect(words).toEqual([
      ['hello', 45, 60],
      ['there', 90, 105],
    ])
    // At double speed the same source second lands half as far in.
    expect(wordsOnTimeline({ ...item, speed: 2 }, transcript([['hi', 3, 3.5]]), 30)).toEqual([
      ['hi', 45, 53],
    ])
  })

  it('describes items, transitions and speech, once per video and its linked audio', () => {
    seed()
    const snapshot = captureSnapshot()
    const audio = {
      ...video({ id: 'a1', trackId: 'tv' }),
      type: 'audio' as const,
      linkedGroupId: 'g',
    }
    const json = JSON.parse(
      describeTimeline({
        snapshot: {
          ...snapshot,
          items: [
            ...snapshot.items.map((i) => (i.id === 'v1' ? { ...i, linkedGroupId: 'g' } : i)),
            audio,
          ],
        },
        media: [],
        transcripts: { m1: transcript([['hi', 0.5, 0.8]]) },
        selectedItemIds: ['title'],
      }),
    )
    expect(json.fps).toBe(30)
    expect(json.items.map((i: { id: string }) => i.id)).toEqual(['v1', 'title', 'a1', 'v2'])
    expect(json.items.find((i: { id: string }) => i.id === 'title')).toMatchObject({
      text: 'Hello',
      fontSize: 80,
    })
    expect(json.speech.map((s: { itemId: string }) => s.itemId)).toEqual(['v1', 'v2'])
    expect(json.selectedItemIds).toEqual(['title'])
  })

  it('lists the effects and transitions this build has', () => {
    const catalog = JSON.parse(describeCatalog())
    expect(catalog.effects.length).toBe(GPU_EFFECT_REGISTRY.size)
    expect(catalog.effects[0]).toHaveProperty('params')
  })
})

describe('Edit with Alu: applying a plan', () => {
  beforeEach(seed)

  it('fills an effect’s unspecified params with their defaults', () => {
    const id = [...GPU_EFFECT_REGISTRY.keys()][0]!
    const op = toEditOp({ op: 'addEffect', args: { itemId: 'v1', gpuEffectType: id, params: {} } })
    expect(op).toMatchObject({
      op: 'addEffect',
      itemId: 'v1',
      params: getGpuEffectDefaultParams(id),
    })
  })

  it('makes the whole plan one undo step, $refs included, and undoes it', () => {
    const applied = applyAluOps([
      {
        op: 'addText',
        args: { text: 'Book today', from: 30, durationInFrames: 60 },
        callerId: 'cta',
      },
      { op: 'setTransform', args: { id: { $ref: 'cta#/detail/id' }, transform: { y: 400 } } },
      { op: 'moveItem', args: { id: 'title', from: 15 } },
    ])
    expect(applied.applied).toBe(3)
    const { undoStack } = useTimelineCommandStore.getState()
    expect(undoStack).toHaveLength(1)
    expect(undoStack[0]!.command.type).toBe(ALU_COMMAND)
    const cta = useItemsStore
      .getState()
      .items.find((i) => i.type === 'text' && i.text === 'Book today')
    expect(cta?.transform?.y).toBe(400)
    expect(fromOf('title')).toBe(15)

    expect(undoAlu(applied.token)).toBe(true)
    expect(fromOf('title')).toBe(0)
    expect(useItemsStore.getState().items).toHaveLength(3)
  })

  it('changes nothing when a step fails, and leaves the history as it was', () => {
    useTimelineCommandStore.getState().clearHistory()
    expect(() =>
      applyAluOps([
        { op: 'moveItem', args: { id: 'title', from: 20 } },
        { op: 'removeItems', args: { ids: ['nope'] } },
      ]),
    ).toThrow(/removeItems/)
    expect(fromOf('title')).toBe(0)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })

  it('folds the check pass’s fixes into the same undo step', () => {
    const first = applyAluOps([{ op: 'moveItem', args: { id: 'title', from: 30 } }])
    applyAluOps([{ op: 'setTransform', args: { id: 'title', transform: { y: 300 } } }], first)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    undoAlu(first.token)
    expect(fromOf('title')).toBe(0)
    expect(useItemsStore.getState().itemById.title?.transform?.y).toBeUndefined()
  })

  it('leaves captions and cuts as actions to run after', () => {
    const r = applyAluOps([
      { op: 'captions', args: {} },
      { op: 'removeSilence', args: {} },
    ])
    expect(r.applied).toBe(0)
    expect(r.actions.map((a) => a.op)).toEqual(['captions', 'removeSilence'])
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)
  })
})
