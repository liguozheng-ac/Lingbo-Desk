import type { SettingsSearchModule } from '@lingbo/stage-ui/libs/settings-search'

import { settingsSearchItemKey } from '@lingbo/stage-shared/settings-search'
import { useLingboCardStore } from '@lingbo/stage-ui/stores/modules/lingbo-card'

/** The character cards page, with each card. A result of a card opens the page of the card. */
export default {
  routes: [{
    path: '/settings/lingbo-card',
    items: () => [...useLingboCardStore().cards.entries()].map(([id, card]) => ({
      title: card.name,
      key: settingsSearchItemKey('card', id),
      to: `/settings/lingbo-card/${id}`,
    })),
  }],
} satisfies SettingsSearchModule
