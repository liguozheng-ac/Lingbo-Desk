declare module '*?settings-search' {
  import type { SettingsSearchViewEntry } from '@lingbo/stage-shared/settings-search'

  /** The settings that the component renders. `@lingbo/stage-pages/vite/settings-search` reads them at build time. */
  const entries: SettingsSearchViewEntry[]
  export default entries
}
