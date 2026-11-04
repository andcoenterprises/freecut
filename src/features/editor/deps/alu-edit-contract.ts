/**
 * Edit with Alu: the headless edit API (run on the open timeline), captions from
 * transcripts, and the filler-word preview.
 */

export { applyEditOpsLive } from '@/headless/edit'
export type { EditOp } from '@/headless/edit-op-support'
export { transcriptCaptions } from '@/features/media-library/services/transcript-captions'
export { openFillerRemovalPreview } from '@/features/timeline/utils/filler-removal-open'
