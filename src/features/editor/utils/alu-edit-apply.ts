/**
 * Running an Edit with Alu plan on the open timeline. The ops go through the headless
 * edit API (the same timeline actions the editor's own tools use), all or nothing: if one
 * fails, the timeline is put back as it was. The whole request, including its check pass,
 * is one entry in the undo history ("Edit With Alu"). Captions, filler removal and silence
 * removal are editor actions run afterwards with the editor's own flows.
 */

import type { AluOp } from '@/shared/alumi/studio-ai'
import { getGpuEffectDefaultParams } from '@/infrastructure/gpu-effects'
import {
  captureSnapshot,
  useItemsStore,
  useTimelineCommandStore,
} from '@/features/editor/deps/timeline-store'
import { useSilenceRemovalDialogStore } from '@/features/editor/deps/timeline-ui'
import {
  applyEditOpsLive,
  openFillerRemovalPreview,
  transcriptCaptions,
  type EditOp,
} from '@/features/editor/deps/alu-edit'

export const ALU_COMMAND = 'EDIT_WITH_ALU'
const ACTIONS = new Set(['captions', 'removeFillers', 'removeSilence'])

type Snapshot = ReturnType<typeof captureSnapshot>

/** An AluOp as the headless API takes it; an effect's unspecified params keep their defaults. */
export function toEditOp(o: AluOp): EditOp {
  const args: Record<string, unknown> = { ...o.args }
  delete args.op
  if (o.op === 'addEffect' && typeof args.gpuEffectType === 'string' && !args.effect) {
    const given = args.params && typeof args.params === 'object' ? args.params : {}
    args.params = { ...getGpuEffectDefaultParams(args.gpuEffectType), ...given }
  }
  return { ...args, op: o.op, ...(o.callerId ? { callerId: o.callerId } : {}) } as EditOp
}

function setStacks(undoStack: unknown[], redoStack: unknown[]) {
  useTimelineCommandStore.setState({
    undoStack: undoStack as never,
    redoStack: redoStack as never,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  })
}

export type AppliedAlu = {
  /** The timeline before the request, kept so a check pass joins the same undo entry. */
  before: Snapshot
  /** Identifies this request's undo entry. */
  token: string
  /** Editor actions still to run. */
  actions: AluOp[]
  applied: number
}

/**
 * Apply ops as one undo entry. With `joining` (a check pass), the fixes join the first
 * pass's entry when it's still the latest; otherwise they get their own.
 */
export function applyAluOps(ops: AluOp[], joining?: AppliedAlu): AppliedAlu {
  const editOps = ops.filter((o) => !ACTIONS.has(o.op)).map(toEditOp)
  const actions = ops.filter((o) => ACTIONS.has(o.op))
  const before = captureSnapshot()
  const token = joining?.token ?? crypto.randomUUID()
  if (editOps.length === 0) return { before: joining?.before ?? before, token, actions, applied: 0 }

  const history = useTimelineCommandStore.getState()
  let undoStack = history.undoStack
  const redoStack = history.redoStack
  let since = before
  const top = undoStack.at(-1)
  if (joining && top?.command.type === ALU_COMMAND && top.command.payload?.token === token) {
    undoStack = undoStack.slice(0, -1)
    since = joining.before
  }

  const meta = before.projectMetadata
  try {
    applyEditOpsLive(editOps, {
      width: meta?.width ?? 1920,
      height: meta?.height ?? 1080,
      fps: meta?.fps ?? before.fps ?? 30,
    })
  } catch (error) {
    // Put the timeline back: record `before` as one entry, undo it, then restore the history.
    setStacks(history.undoStack, redoStack)
    const store = useTimelineCommandStore.getState()
    store.addUndoEntry({ type: ALU_COMMAND, payload: { token, rollback: true } }, before)
    if (useTimelineCommandStore.getState().undoStack.at(-1)?.command.payload?.rollback) store.undo()
    setStacks(history.undoStack, redoStack)
    throw error
  }
  // Drop the per-op entries the actions recorded, then record the request as one.
  setStacks(undoStack, redoStack)
  useTimelineCommandStore
    .getState()
    .addUndoEntry({ type: ALU_COMMAND, payload: { token, count: editOps.length } }, since)
  return { before: since, token, actions, applied: editOps.length }
}

/** Undo the request, when it's still the latest thing done. */
export function undoAlu(token: string): boolean {
  const top = useTimelineCommandStore.getState().undoStack.at(-1)
  if (top?.command.type !== ALU_COMMAND || top.command.payload?.token !== token) return false
  useTimelineCommandStore.getState().undo()
  return true
}

const idsOf = (args: Record<string, unknown>) =>
  Array.isArray(args.itemIds) ? args.itemIds.filter((x): x is string => typeof x === 'string') : []

/** The clips an action is for: the ones named, else every clip with sound. */
function speechClips(args: Record<string, unknown>) {
  const { items, itemById } = useItemsStore.getState()
  const named = idsOf(args)
  const pool = named.length ? named.map((id) => itemById[id]).filter(Boolean) : items
  return pool.filter(
    (i): i is NonNullable<typeof i> & { mediaId: string } =>
      !!i && (i.type === 'video' || i.type === 'audio') && !!i.mediaId,
  )
}

async function addCaptions(args: Record<string, unknown>): Promise<string> {
  const clips = speechClips(args)
  if (!clips.length) return 'No clips with sound to caption.'
  // One caption set per clip: a video and its linked audio are the same speech.
  const byMedia = new Map<string, string[]>()
  for (const clip of clips) {
    if (
      clip.type === 'audio' &&
      clip.linkedGroupId &&
      clips.some((c) => c.type === 'video' && c.linkedGroupId === clip.linkedGroupId)
    )
      continue
    byMedia.set(clip.mediaId, [...(byMedia.get(clip.mediaId) ?? []), clip.id])
  }
  let added = 0
  let failed = 0
  let reason = ''
  for (const [mediaId, clipIds] of byMedia) {
    try {
      added += (await transcriptCaptions.captionClips(mediaId, clipIds)) ?? 0
    } catch (error) {
      failed += 1
      reason ||= error instanceof Error ? error.message : String(error)
    }
  }
  const clipsWord = (n: number) => `${n} clip${n === 1 ? '' : 's'}`
  if (failed && !added)
    return `Captions couldn’t be made for these clips${reason ? `: ${reason}` : '.'}`
  return failed
    ? `Captions added to ${clipsWord(added)}; ${clipsWord(failed)} couldn’t be transcribed.`
    : `Captions added to ${clipsWord(added)}.`
}

async function previewFillers(args: Record<string, unknown>): Promise<string> {
  const ids = speechClips(args).map((c) => c.id)
  if (!ids.length) return 'No clips with speech to check for filler words.'
  if ((await openFillerRemovalPreview(ids)) === 0) return 'No filler words found.'
  return 'Filler words are marked on the timeline: check them and confirm to cut.'
}

function previewSilence(args: Record<string, unknown>): string {
  const ids = speechClips(args).map((c) => c.id)
  if (!ids.length) return 'No clips with sound to check for pauses.'
  useSilenceRemovalDialogStore.getState().open({ itemIds: ids })
  return 'Pauses are being found: check them and confirm to cut.'
}

/**
 * Run the editor actions, one line each for the person. Filler and silence removal open
 * the editor's own preview, which the person confirms; only one can be open at once, so a
 * second one is left for later.
 */
export async function runAluActions(actions: AluOp[]): Promise<string[]> {
  const lines: string[] = []
  let previewOpen = false
  for (const a of actions) {
    try {
      if (a.op === 'captions') lines.push(await addCaptions(a.args))
      else if (previewOpen)
        lines.push(
          `Ask again for ${a.op === 'removeFillers' ? 'filler words' : 'pauses'} once you’ve confirmed the first cut.`,
        )
      else if (a.op === 'removeFillers') {
        const line = await previewFillers(a.args)
        lines.push(line)
        previewOpen = line !== 'No filler words found.' && !line.startsWith('No clips')
      } else if (a.op === 'removeSilence') {
        lines.push(previewSilence(a.args))
        previewOpen = true
      }
    } catch (error) {
      lines.push(error instanceof Error ? error.message : 'That step didn’t work.')
    }
  }
  return lines
}
