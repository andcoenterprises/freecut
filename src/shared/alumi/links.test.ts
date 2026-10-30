import { describe, it, expect } from 'vitest'
import { linkKind, projectSyncUrl, uploadPathPrefix, uploadRecordUrl } from './links'

describe('studio links', () => {
  const post = { postId: 'p1', workspaceId: 'w1', origin: 'https://studio.test' }
  const ws = { kind: 'workspace' as const, workspaceId: 'w1', origin: 'https://studio.test' }
  it('treats an old link without a kind as a post', () => {
    expect(linkKind(post)).toBe('post')
    expect(linkKind(ws)).toBe('workspace')
  })
  it("points a post's edit at the post and a sub-account video at the workspace", () => {
    expect(projectSyncUrl(post, 'x')).toBe('https://studio.test/api/creative/editor/p1')
    expect(projectSyncUrl(ws, 'x')).toBe(
      'https://studio.test/api/creative/editor/workspace/w1/projects/x',
    )
    expect(uploadRecordUrl(post)).toBe('https://studio.test/api/creative/editor/p1')
    expect(uploadRecordUrl(ws)).toBe('https://studio.test/api/creative/editor/workspace/w1')
    expect(uploadPathPrefix(post)).toBe('creative/w1/media/p1/')
    expect(uploadPathPrefix(ws)).toBe('creative/w1/media/library/')
  })
})
