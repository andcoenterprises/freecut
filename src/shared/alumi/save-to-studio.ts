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

/**
 * Send a file to the post as its own media, with Studio's upload token. Returns
 * the Studio media id it was recorded as.
 */
export async function uploadFileToStudio(
  file: File,
  link: StudioLink,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; mediaId: string } | { ok: false; error: string }> {
  const name = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'file'
  try {
    const stored = await upload(`creative/${link.workspaceId}/media/${link.postId}/${name}`, file, {
      access: 'private',
      handleUploadUrl: `${link.origin}/api/creative/files/upload`,
      clientPayload: JSON.stringify({ workspaceId: link.workspaceId, kind: 'post-media' }),
      multipart: file.size > MULTIPART_FROM_BYTES,
    })
    const response = await fetchImpl(
      `${link.origin}/api/creative/editor/${encodeURIComponent(link.postId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pathname: stored.pathname, url: stored.url, name }),
      },
    )
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      media?: { id?: string }
    }
    if (!response.ok || !data.media?.id) {
      return {
        ok: false,
        error: data.error || `Studio didn't accept the file (${response.status}).`,
      }
    }
    return { ok: true, mediaId: data.media.id }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The upload failed. Try again.',
    }
  }
}

export async function saveExportToStudio(
  blob: Blob,
  mimeType: string,
  projectName: string,
  link: StudioLink,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const safeName = (projectName.trim() || 'video').replace(/[^\w.\- ]+/g, '_').slice(0, 60)
  const file = new File([blob], `${safeName}.${extensionFor(mimeType)}`, { type: mimeType })
  const r = await uploadFileToStudio(file, link)
  return r.ok ? { ok: true } : r
}
