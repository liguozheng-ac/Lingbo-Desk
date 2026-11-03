import type { Extension } from './shared'

/**
 * Defines an LINGBO extension entrypoint.
 *
 * Use when:
 * - Authoring an extension package that runs setup code and may use host-provided kits
 * - Keeping extension metadata and setup logic in one explicit export
 *
 * Expects:
 * - `id` matches `extension.lingbo.json`
 * - `setup` uses `ctx.kits` for the common kit authoring path
 *
 * Returns:
 * - The extension definition consumed by an extension host loader
 */
export function defineExtension(extension: Extension): Extension {
  return extension
}
