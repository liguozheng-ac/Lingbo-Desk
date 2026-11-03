import type { SherpawModelResource } from '@lingbo/provider-inference'

import { sherpawModels } from '@lingbo/provider-inference'
import { assets } from '@lingbo/vite-plugin-sherpaw/assets'

/** Models that the host exposes as bundled files or pinned remote downloads. */
export const sherpawModelResources: SherpawModelResource[] = Object.values(sherpawModels).flatMap((model) => {
  const files = assets[model.id]
  return files ? [{ model, files }] : []
})

export const availableSherpawModels = sherpawModelResources.map(({ model }) => model)
