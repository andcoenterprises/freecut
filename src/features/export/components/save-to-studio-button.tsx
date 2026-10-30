/**
 * "Save to Studio": sends a finished export back to the AlumiAI Studio post this
 * project was opened from (see src/routes/studio.tsx). Shown only in hosted
 * builds, for projects that came from a post.
 */

import { useState } from 'react'
import { CheckCircle2, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HOSTED } from '@/config/hosting'
import { useProjectStore } from '@/features/export/deps/projects'
import { studioLinkForProject } from '@/shared/alumi/links'
import { saveExportToStudio } from '@/shared/alumi/save-to-studio'
import type { ClientRenderResult } from '../deps/renderer'

export function SaveToStudioButton({ result }: { result: ClientRenderResult | null }) {
  const project = useProjectStore((s) => s.currentProject)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)
  const link = HOSTED && project ? studioLinkForProject(project.id) : undefined
  if (!link || !project || !result) return null

  const save = async () => {
    setState('saving')
    setError(null)
    const r = await saveExportToStudio(result.blob, result.mimeType, project.name, link)
    if (r.ok) {
      setState('saved')
    } else {
      setState('idle')
      setError(r.error)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={save}
        disabled={state !== 'idle'}
        variant={state === 'saved' ? 'outline' : 'default'}
      >
        {state === 'saving' ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : state === 'saved' ? (
          <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
        ) : (
          <Upload className="mr-2 h-4 w-4" />
        )}
        {state === 'saving'
          ? 'Saving to Studio…'
          : state === 'saved'
            ? 'Saved to Studio'
            : 'Save to Studio'}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
