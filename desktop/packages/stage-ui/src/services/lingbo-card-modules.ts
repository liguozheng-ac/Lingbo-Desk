import type { LingboExtension } from '../types/lingboCard'

/** Persisted defaults, separate from the selections applied by the active card. */
export type CardModuleDefaults = Pick<LingboExtension['modules'], 'consciousness' | 'vision' | 'speech'>

/**
 * Resolves a card selection without borrowing a model from another provider.
 * An empty model remains unconfigured when the card changes provider.
 * The caller must ask for a model or use that provider's own default.
 */
export function resolveModuleSelection(
  selection: LingboExtension['modules']['consciousness'],
  defaults: LingboExtension['modules']['consciousness'],
): LingboExtension['modules']['consciousness'] {
  const provider = selection.provider || defaults.provider
  const model = selection.model || (provider === defaults.provider ? defaults.model : '')
  return { provider, model }
}
