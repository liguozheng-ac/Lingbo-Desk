/// <reference path="../../settings-search-entries.d.ts" />

import messages from '@lingbo/i18n/locales'
import workerURL from '@sherpaw/xsai-transcription/worker?worker&url'

import { resolveSupportedLocale } from '@lingbo/i18n'
import { createSherpawTranscriptionDefinition } from '@lingbo/provider-inference'
import { isStageCapacitor } from '@lingbo/stage-shared'

import { defineProvider } from '../registry'
import { fetchSherpawModel } from './model-assets'
import { sherpawModelResources } from './model-resources'

export { executeSherpawStream, SHERPAW_TRANSCRIPTION_PROVIDER_ID } from '@lingbo/provider-inference'

function getInterfaceLanguage(): string {
  const language = globalThis.localStorage?.getItem('settings/language') || globalThis.navigator?.language || 'en'
  return resolveSupportedLocale(language, Object.keys(messages))
}

function isMobile(): boolean {
  return isStageCapacitor() || (globalThis.matchMedia?.('(max-width: 767px)').matches ?? false)
}

export const providerSherpawTranscription = defineProvider({
  ...createSherpawTranscriptionDefinition({
    models: sherpawModelResources,
    workerURL,
    fetchModel: fetchSherpawModel,
    getInterfaceLanguage,
    isMobile,
  }),
  // The settings live in the Hearing module, not under /settings/providers.
  to: '/settings/modules/hearing/transcriber',
  views: {
    hearing: () => import('./hearing-settings.vue'),
  },
  viewSearchEntries: {
    hearing: () => import('./hearing-settings.vue?settings-search'),
  },
})
