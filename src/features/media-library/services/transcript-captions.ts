/**
 * Captions for clips from their media's transcript, transcribing first when the media has
 * none (the same steps as the timeline's Generate captions). Used by Edit with Alu.
 */

import { mediaTranscriptionService } from './media-transcription-service'
import { runMediaTranscriptionJob } from './media-transcription-runner'
import { getDefaultMediaTranscriptionModel } from '../transcription/registry'

/**
 * Used when the default engine can't run. The default, Parakeet, fetches its model from a
 * Hugging Face repo whose files have moved (404 since late 2026); Whisper's still load.
 */
const FALLBACK_MODEL = 'whisper-small' as const

export const transcriptCaptions = {
  getTranscript: (mediaId: string) => mediaTranscriptionService.getTranscript(mediaId),

  /** Caption these clips of one media; the number of clips captioned, or null when transcription was cancelled. */
  async captionClips(mediaId: string, clipIds: string[]): Promise<number | null> {
    if (!(await mediaTranscriptionService.getTranscript(mediaId))) {
      const model = getDefaultMediaTranscriptionModel()
      let job
      try {
        job = await runMediaTranscriptionJob(mediaId, { model })
      } catch (error) {
        if (model === FALLBACK_MODEL) throw error
        job = await runMediaTranscriptionJob(mediaId, { model: FALLBACK_MODEL })
      }
      if (job.status === 'cancelled') return null
    }
    const result = await mediaTranscriptionService.enableTranscriptCaptions(mediaId, { clipIds })
    return result.updatedClipCount
  },
}
