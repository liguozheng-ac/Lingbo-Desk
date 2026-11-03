<script setup lang="ts">
import { OverlayButton } from '@lingbo/ui'

const props = defineProps<{ buttonStyle?: string }>()
</script>

<template>
  <OverlayButton
    size="sm"
    :class="[
      'p-2!',
      props.buttonStyle,
    ]"
  >
    <slot />
  </OverlayButton>
</template>
