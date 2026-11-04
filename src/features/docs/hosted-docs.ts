/**
 * The user guide inside AlumiAI Studio (a VITE_HOSTED=alumi build).
 *
 * There the editor keeps projects in the browser's own storage (OPFS) and in
 * Studio, not in a workspace folder the person picks, and is opened from Studio
 * rather than a Projects page. So the hosted guide:
 *   - replaces the "Workspaces and Storage" page with "Working in AlumiAI Studio",
 *   - rewrites the handful of sentences elsewhere that talk about the workspace folder.
 * Upstream's page files stay untouched, so FreeCut updates keep merging cleanly.
 * Rewrites match whole strings exactly; one that no longer matches is simply not
 * applied (a test checks every rewrite still finds its sentence).
 */

import type { DocPageContent } from './docs-content'

export const STUDIO_PAGE: DocPageContent = {
  order: 2,
  slug: 'in-studio',
  title: 'Working in AlumiAI Studio',
  description:
    'Opening the editor from Studio, where your projects are kept, saving to Studio, and Studio AI.',
  category: 'Start',
  related: ['getting-started', 'local-ai', 'export'],
  sections: [
    {
      title: 'Opening the editor',
      blocks: [
        {
          kind: 'list',
          items: [
            'From a post: on a video post’s production plan, or a video post with clips but no plan, choose **Open in editor**. The plan’s clips, cards, voiceover and captions are laid out on the timeline for you.',
            'From scratch: in **Creative Studio → Creation**, open the video editing tab, pick saved media (or upload your own), choose the shape, and **Create video**.',
            'Videos in progress are listed on that tab. **Open** reopens one on any computer.',
            '**Start again** on a post builds a fresh layout from the plan as it is now.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'The editor needs Chrome or Edge on a computer. It runs in your browser, using your graphics card for preview, effects and export.',
        },
      ],
    },
    {
      title: 'Where your work is kept',
      blocks: [
        {
          kind: 'list',
          items: [
            'Projects and their media are kept in this browser’s own storage, so they open instantly here.',
            'A few seconds after each save, the project is also kept in Studio, with any files you imported yourself. Open the same video on another computer and it’s restored from Studio.',
            'There is no folder to pick and nothing to reconnect.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Clearing this site’s data in the browser removes the copy here. Projects opened from Studio come back from Studio, unless a project is over 4 MB of project data: those are only kept here.',
        },
      ],
    },
    {
      title: 'Saving your video to Studio',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Choose **Export** and render the video.',
            'Choose **Save to Studio**. The video is added to the post (or to the sub-account’s saved media), ready to approve and publish.',
            '**Download** still saves a copy to your computer.',
          ],
        },
      ],
    },
    {
      title: 'Studio AI',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Open the **AI** tab. The **Studio AI** section at the top makes new media with Creative Studio’s models, charged to the sub-account’s wallet like everything else in Creative Studio.',
        },
        {
          kind: 'list',
          items: [
            '**Clip**: pick a video model, describe the shot (subject, action, setting, camera, light), choose the shape, length and quality, and **Make clip**. The price shows before you start. It’s made in the background while you keep editing, then appears in your media.',
            '**Picture**: the same for still images. Leave words out of the prompt and add them with a text layer, so they’re spelled exactly right.',
            '**Voiceover**: pick one of the sub-account’s voices, write the script the way it should be heard, and **Make voiceover**. It goes on a new audio track at the playhead.',
            'Everything made here is also kept in Studio.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'The tools further down the AI tab (text to speech, music, transcription) run free in your browser and download their models the first time you use them.',
        },
      ],
    },
    {
      title: 'When something looks wrong',
      blocks: [
        {
          kind: 'list',
          items: [
            'A panel says it couldn’t load, or a “new version” notice appears: the editor was updated. Save, then reload the tab.',
            'Studio AI says it didn’t recognise you: you were signed out of Studio. Sign in to Studio in another tab, then reload the editor.',
            'A clip shows as failed: nothing was charged. Try again, or pick another model.',
          ],
        },
      ],
    },
  ],
}

/** Exact sentences in upstream's pages → what the Studio build says instead (null: leave it out). */
export const HOSTED_REWRITES: ReadonlyMap<string, string | null> = new Map([
  [
    'Your media stays on your device. FreeCut links to the original files and writes projects, caches, and exports to a **workspace folder** you choose — nothing is sent to the cloud.',
    'Editing runs on your own computer. Projects are kept in this browser and in AlumiAI Studio, so they open on any computer — see [Working in AlumiAI Studio](in-studio).',
  ],
  [
    'FreeCut uses the File System Access API (workspace folders), WebCodecs (decode and export), WebGPU (effects, color, AI), and OPFS (caches). Keep hardware acceleration on and GPU drivers current.',
    'FreeCut uses WebCodecs (decode and export), WebGPU (effects, color, AI), and the browser’s own storage (OPFS). Keep hardware acceleration on and GPU drivers current.',
  ],
  [
    'Open FreeCut in a supported browser and, when prompted, pick a **workspace folder** you can read and write.',
    'Open FreeCut from AlumiAI Studio: **Open in editor** on a post, or **Create video** in Creative Studio → Creation.',
  ],
  ['The workspace picker opens and accepts a normal folder (not a protected system location).', null],
  ['The active workspace is shown on the Projects page, so you always know where projects are stored.', null],
  [
    'Import a bundle into another workspace to continue the same edit on a different machine or folder.',
    'Import a bundle on another computer to continue the same edit there (videos opened from Studio come back from Studio by themselves).',
  ],
  [
    'When it completes, choose **Download** to save the file, which is also written to the exports folder in your workspace.',
    'When it completes, choose **Save to Studio** to add it to the post or the sub-account’s media, or **Download** to save a copy.',
  ],
  ['Queued exports render one at a time and save to the exports folder in your workspace.', 'Queued exports render one at a time and are kept with the project.'],
  ['The files live in this project folder inside your workspace.', 'The files are kept with this project in the browser.'],
  ['The folder FreeCut reads from and writes to.', 'In AlumiAI Studio: this browser’s storage, plus the copy kept in Studio.'],
  [
    'FreeCut runs in your browser and stores everything in a **workspace folder** on your disk.',
    'FreeCut runs in your browser and keeps projects in the browser’s storage and in AlumiAI Studio.',
  ],
  [
    'Projects, caches, generated assets, and exports are written into the workspace, so you can back it up or move it like any folder.',
    'Projects, caches, generated assets, and exports are kept in the browser; projects are also kept in Studio.',
  ],
  ['Unsupported browser, or no workspace picker', 'Unsupported browser'],
])

const REMOVED = Symbol('removed')

function rewrite(value: unknown): unknown {
  if (typeof value === 'string') {
    if (!HOSTED_REWRITES.has(value)) return value
    return HOSTED_REWRITES.get(value) ?? REMOVED
  }
  if (Array.isArray(value)) return value.map(rewrite).filter((v) => v !== REMOVED)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = rewrite(v)
      out[k] = r === REMOVED ? '' : r
    }
    return out
  }
  return value
}

/** The guide's pages as the Studio build shows them. */
export function hostedPages(pages: DocPageContent[]): DocPageContent[] {
  return [...pages.filter((p) => p.slug !== 'workspaces'), STUDIO_PAGE]
    .map((p) => rewrite(p) as DocPageContent)
    .map((p) => ({ ...p, related: p.related?.map((s) => (s === 'workspaces' ? 'in-studio' : s)) }))
    .sort((a, b) => a.order - b.order)
}
