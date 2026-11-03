<script lang="ts" setup>
import { ScrollableArea } from '@lingbo/ui'
</script>

<template>
  <ScrollableArea
    :class="[
      'bg-neutral-100 dark:bg-neutral-800',
    ]"
  >
    <slot />
  </ScrollableArea>
</template>
