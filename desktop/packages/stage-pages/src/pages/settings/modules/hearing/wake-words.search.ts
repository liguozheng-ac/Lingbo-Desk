import type { SettingsSearchModule } from '@lingbo/stage-ui/libs/settings-search'

import { settingsSearchItemKey } from '@lingbo/stage-shared/settings-search'
import { useLingboCardStore } from '@lingbo/stage-ui/stores/modules/lingbo-card'

/** The marker of a wake word's block. A word is unique for each card. */
export function wakeWordSearchKey(cardId: string, text: string) {
  return settingsSearchItemKey('wake-word', cardId, text)
}

/** The wake words page, with the words of every card and the card that answers each one, as the page groups them. */
export default {
  routes: [{
    path: '/settings/modules/hearing/wake-words',
    items: () => [...useLingboCardStore().cards].flatMap(([id, card]) =>
      (card.extensions.lingbo.wakeWords ?? []).map(word => ({ title: word.text, key: wakeWordSearchKey(id, word.text), section: card.name }))),
  }],
} satisfies SettingsSearchModule
