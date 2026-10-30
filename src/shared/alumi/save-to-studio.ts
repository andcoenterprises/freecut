/**
 * Save an export back to its AlumiAI Studio post.
 *
 * The file goes straight to Studio's private Blob store with a short-lived
 * token from its /api/creative/files/upload (so size isn't limited by a
 * request body), then Studio records it as the post's video. Both calls are
 * same-origin, so they carry the user's own session.
 */

import { upload } from '@vercel/blob/client'
import type { StudioLink } from './links'

const MULTIPART_FROM_BYTES = 20 * 1024 * 1024

function extensionFor(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('quicktime')) return 'mov'
  if (mimeType.startsWith('audio/')) return mimeType.includes('wav') ? 'wav' : 'm4a'
  return 'mp4'
}

export async function saveExportToStudio(
  blob: Blob,
  mimeType: string,
  projectName: string,
  link: StudioLink,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const safeName = (projectName.trim() || 'video').replace(/[^\w.\- ]+/g, '_').slice(0, 60)
  const name = `${safeName}.${extensionFor(mimeType)}`
  const file = new File([blob], name, { type: mimeType })
  try {
    const stored = await upload(`creative/${link.workspaceId}/media/${link.postId}/${name}`, file, {
      access: 'private',
      handleUploadUrl: `${link.origin}/api/creative/files/upload`,
      clientPayload: JSON.stringify({ workspaceId: link.workspaceId, kind: 'post-media' }),
      multipart: file.size > MULTIPART_FROM_BYTES,
    })
    const response = await fetch(
      `${link.origin}/api/creative/editor/${encodeURIComponent(link.postId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pathname: stored.pathname, url: stored.url, name }),
      },
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      return {
        ok: false,
        error: body.error || `Studio didn't accept the video (${response.status}).`,
      }
    }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The upload failed. Try again.',
    }
  }
}
