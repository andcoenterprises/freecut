/**
 * "A project was saved" events, raised by the storage layer after every project
 * write. A host app (AlumiAI Studio) subscribes to keep its own copy of the
 * project; nothing listens in a stand-alone build.
 */

import type { Project } from '@/types/project'

type Listener = (project: Project) => void

const listeners = new Set<Listener>()

export function onProjectSaved(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyProjectSaved(project: Project): void {
  for (const listener of listeners) {
    try {
      listener(project)
    } catch {
      // A listener's failure must never fail the save itself.
    }
  }
}
