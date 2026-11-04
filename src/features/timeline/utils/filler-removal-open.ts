/**
 * Find filler words in these clips, mark them on the timeline, and open the filler
 * removal dialog to confirm the cut (the same steps as the clip menu's Remove filler
 * words). Returns how many were found; with none, the dialog isn't opened.
 */

import { useFillerRemovalDialogStore } from '../stores/filler-removal-dialog-store'
import {
  analyzeFillerWordsForItems,
  applyFillerPreviewOverlays,
  DEFAULT_FILLER_REMOVAL_SETTINGS,
} from './filler-word-removal-preview'

export async function openFillerRemovalPreview(itemIds: string[]): Promise<number> {
  const rangesByMediaId = await analyzeFillerWordsForItems(itemIds, DEFAULT_FILLER_REMOVAL_SETTINGS)
  const summary = applyFillerPreviewOverlays(itemIds, rangesByMediaId)
  if (summary.rangeCount === 0) return 0
  useFillerRemovalDialogStore.getState().open({
    itemIds,
    settings: DEFAULT_FILLER_REMOVAL_SETTINGS,
    rangesByMediaId,
    summary,
  })
  return summary.rangeCount
}
