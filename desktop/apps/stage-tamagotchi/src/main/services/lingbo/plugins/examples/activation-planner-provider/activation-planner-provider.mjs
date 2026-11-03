import { defineExtension, defineKitContract, defineKitMethod } from '@lingbo/plugin-sdk'

const contract = defineKitContract({
  id: 'dev.lingbo.example-activation',
  version: '1.0.0',
  methods: { read: defineKitMethod() },
  events: {},
})

/**
 * Declares a Kit that the Activation Planner can use for static dependency planning.
 *
 * Phase 3 also registers the declared Kit before the Consumer starts.
 */
export default defineExtension({
  id: 'activation-planner-provider',
  setup(ctx) {
    ctx.kits.provide(contract, { methods: { read: () => 'ready' } })
    console.info('[activation-planner-provider] setup')
  },
})
