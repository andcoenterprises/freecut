import { describe, it, expect } from 'vitest'
import type { Project, ProjectTimeline } from '@/types/project'
import { projectForSync, referencedMediaIds, rewriteMediaIds } from './sync'

const timeline: ProjectTimeline = {
  tracks: [],
  items: [
    {
      id: 'a',
      trackId: 't',
      from: 0,
      durationInFrames: 10,
      label: 'A',
      type: 'video',
      mediaId: 'm1',
    },
    {
      id: 'b',
      trackId: 't',
      from: 0,
      durationInFrames: 10,
      label: 'B',
      type: 'audio',
      mediaId: 'm1',
    },
    {
      id: 'c',
      trackId: 't',
      from: 10,
      durationInFrames: 10,
      label: 'C',
      type: 'image',
      mediaId: 'm2',
    },
    { id: 'd', trackId: 't', from: 20, durationInFrames: 10, label: 'D', type: 'text', text: 'Hi' },
  ],
}

describe('referencedMediaIds', () => {
  it('lists each media id once, ignoring items without one', () => {
    expect(referencedMediaIds(timeline)).toEqual(['m1', 'm2'])
    expect(referencedMediaIds(undefined)).toEqual([])
  })
})

describe('rewriteMediaIds', () => {
  it('swaps the ids it knows and leaves the rest', () => {
    const out = rewriteMediaIds(timeline, { m1: 'n1' })
    expect(out.items.map((i) => i.mediaId)).toEqual(['n1', 'n1', 'm2', undefined])
    expect(timeline.items[0]!.mediaId).toBe('m1')
  })
})

describe('projectForSync', () => {
  it('drops the folder handle and the inline thumbnail', () => {
    const project = {
      id: 'p',
      name: 'P',
      description: '',
      createdAt: 1,
      updatedAt: 2,
      duration: 0,
      metadata: { width: 1, height: 1, fps: 30 },
      timeline,
      thumbnail: 'data:...',
      rootFolderHandle: {} as FileSystemDirectoryHandle,
    } satisfies Project
    const out = projectForSync(project)
    expect('thumbnail' in out).toBe(false)
    expect('rootFolderHandle' in out).toBe(false)
    expect(out.timeline).toBe(timeline)
  })
})
