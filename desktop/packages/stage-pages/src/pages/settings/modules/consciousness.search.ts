import type { SettingsSearchModule } from '@lingbo/stage-ui/libs/settings-search'

import { useProviderStore } from '@lingbo/stage-ui/stores/providers/provider'

import { moduleModelItems } from './module-model-search'

/** The consciousness page, with its chat providers and their models. */
export default {
  routes: [{
    path: '/settings/modules/consciousness',
    items: () => moduleModelItems('consciousness', useProviderStore().moduleChatProvidersMetadata),
  }],
} satisfies SettingsSearchModule
