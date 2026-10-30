import { describe, it, expect } from 'vitest'
import { timelineFromSpec, type ImportedMedia, type StudioSpec } from './timeline-from-spec'

const spec: StudioSpec = {
  post: { id: 'p', workspaceId: 'w', name: 'Big news', width: 1080, height: 1920, fps: 30 },
  media: [],
  sequence: [
    { kind: 'media', pieceId: 'p1', mediaId: 'clip', label: 'Shot 1', seconds: 0 },
    { kind: 'media', pieceId: 'p2', mediaId: 'pic', label: 'Picture', seconds: 3 },
    { kind: 'text', pieceId: 'p3', label: 'Offer', text: 'Half price', seconds: 4 },
    { kind: 'media', pieceId: 'p4', mediaId: 'missing', label: 'Not imported', seconds: 2 },
  ],
  under: [{ pieceId: 'p5', mediaId: 'voice', label: 'Voice' }],
  captions: ['Hi', 'There'],
  style: { background: '#102030', text: '#FFFFFF', accent: '#00D4FF', headingFont: 'Inter' },
}

const imported = new Map<string, ImportedMedia>([
  [
    'clip',
    {
      id: 'm1',
      mimeType: 'video/mp4',
      duration: 5.5,
      width: 1080,
      height: 1920,
      fps: 25,
      hasAudio: true,
    },
  ],
  [
    'pic',
    {
      id: 'm2',
      mimeType: 'image/png',
      duration: 0,
      width: 1080,
      height: 1350,
      fps: 0,
      hasAudio: false,
    },
  ],
  [
    'voice',
    { id: 'm3', mimeType: 'audio/mpeg', duration: 20, width: 0, height: 0, fps: 0, hasAudio: true },
  ],
])

describe('timelineFromSpec', () => {
  const timeline = timelineFromSpec(spec, imported)
  const byLabel = (label: string) => timeline.items.find((i) => i.label === label)!

  it('lays the sequence end to end in frames, clips at their real length', () => {
    const shot = byLabel('Shot 1')
    expect([shot.type, shot.from, shot.durationInFrames, shot.mediaId]).toEqual([
      'video',
      0,
      165,
      'm1',
    ])
    expect([shot.sourceFps, shot.sourceEnd]).toEqual([25, 138])
    const pic = byLabel('Picture')
    expect([pic.type, pic.from, pic.durationInFrames]).toEqual(['image', 165, 90])
    const offer = byLabel('Offer')
    expect([offer.type, offer.from, offer.durationInFrames, offer.text]).toEqual([
      'text',
      255,
      120,
      'Half price',
    ])
    expect(timeline.items.some((i) => i.label === 'Not imported')).toBe(false)
  })

  it('gives a clip with sound a linked audio item on the audio track', () => {
    const shot = byLabel('Shot 1')
    const audio = byLabel('Shot 1 audio')
    expect([audio.type, audio.from, audio.durationInFrames]).toEqual(['audio', 0, 165])
    expect(audio.linkedGroupId).toBe(shot.linkedGroupId)
    expect(timeline.tracks.find((t) => t.id === audio.trackId)?.kind).toBe('audio')
    expect(audio.trackId).not.toBe(shot.trackId)
  })

  it('plays a loose voiceover from the start on its own track, and spreads the captions over the longer of the two', () => {
    const voice = byLabel('Voice')
    expect([voice.from, voice.durationInFrames]).toEqual([0, 600])
    const captions = timeline.items.filter((i) => i.label?.startsWith('Caption'))
    expect(captions.map((c) => [c.text, c.from, c.durationInFrames])).toEqual([
      ['Hi', 0, 300],
      ['There', 300, 300],
    ])
    expect(new Set(captions.map((c) => c.trackId)).size).toBe(1)
    expect(captions[0]!.trackId).not.toBe(voice.trackId)
  })

  it('keeps only the tracks in use, captions above the picture', () => {
    expect(timeline.tracks.map((t) => [t.name, t.kind, t.order])).toEqual([
      ['Captions', 'video', -1],
      ['V1', 'video', 0],
      ['A1', 'audio', 1],
      ['A2', 'audio', 2],
    ])
    expect(
      timelineFromSpec({ ...spec, under: [], captions: [] }, imported).tracks.map((t) => t.name),
    ).toEqual(['V1', 'A1'])
  })
})
