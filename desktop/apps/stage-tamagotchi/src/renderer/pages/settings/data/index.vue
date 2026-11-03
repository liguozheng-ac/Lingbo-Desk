<script setup lang="ts">
import type { DataSettingsStatusTone } from '@lingbo/stage-pages/pages/settings/data/status'
import type { ChatSessionsExport } from '@lingbo/stage-ui/types/chat-session'
import type { AlertTone } from '@lingbo/ui'

import ChatsSection from '@lingbo/stage-pages/pages/settings/data/components/chats-section.vue'
import DangerSection from '@lingbo/stage-pages/pages/settings/data/components/danger-section.vue'
import DownloadedModelsSection from '@lingbo/stage-pages/pages/settings/data/components/downloaded-models-section.vue'
import ModelsModulesSection from '@lingbo/stage-pages/pages/settings/data/components/models-modules-section.vue'

import { createDataSettingsStatusState } from '@lingbo/stage-pages/pages/settings/data/status'
import { useChatSessionStore } from '@lingbo/stage-ui/stores/chat/session-store'
import { Alert } from '@lingbo/ui'
import { computed } from 'vue'

import DesktopFolderSection from './components/desktop-folder-section.vue'
import DesktopResetSection from './components/desktop-reset-section.vue'

const { statusMessage, statusTone, handleStatus } = createDataSettingsStatusState()
const chatSession = useChatSessionStore()

const statusAlertTones: Record<DataSettingsStatusTone, AlertTone> = {
  success: 'success',
  error: 'danger',
  neutral: 'info',
}
const statusAlertTone = computed(() => statusAlertTones[statusTone.value])

async function syncImportedChats(payload: ChatSessionsExport) {
  await chatSession.importSessions(payload)
}
</script>

<template>
  <div :class="['flex flex-col gap-4 pb-4']">
    <Alert v-if="statusMessage" :tone="statusAlertTone" live="polite">
      {{ statusMessage }}
    </Alert>
    <DesktopFolderSection @status="handleStatus" />
    <ChatsSection :sync-imported-chats="syncImportedChats" @status="handleStatus" />
    <DownloadedModelsSection @status="handleStatus" />
    <ModelsModulesSection @status="handleStatus" />
    <DesktopResetSection @status="handleStatus" />
    <DangerSection @status="handleStatus" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.data.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.data.description
  icon: i-solar:database-bold-duotone
  settingsEntry: true
  order: 7
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
