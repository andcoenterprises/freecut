/**
 * Wires the Studio project sync (src/shared/alumi/sync.ts) to the editor's
 * media library, for hosted builds. Started once from the app shell.
 */

import { mediaLibraryService } from '@/features/media-library/services/media-library-service'
import { getMedia } from '@/infrastructure/storage'
import { startStudioSync } from '@/shared/alumi/sync'

export function startAlumiSync(): () => void {
  return startStudioSync({
    getMediaFile: (id) => mediaLibraryService.getMediaFile(id),
    getMediaInfo: async (id) => {
      const media = await getMedia(id)
      return media ? { fileName: media.fileName, mimeType: media.mimeType } : undefined
    },
  })
}
