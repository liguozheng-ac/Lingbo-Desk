import type { SettingsSearchModule } from '@lingbo/stage-ui/libs/settings-search'

import { useProviderStore } from '@lingbo/stage-ui/stores/providers/provider'

import { moduleModelItems } from './module-model-search'

/** The vision page, with its vision providers and their models. */
export default {
  routes: [{
    path: '/settings/modules/vision',
    items: () => moduleModelItems('vision', useProviderStore().moduleVisionProvidersMetadata),
  }],
} satisfies SettingsSearchModule
