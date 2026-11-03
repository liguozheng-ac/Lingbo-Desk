import { n as VAR_HUE, r as PresetFactory, t as PresetChromaticOptions } from "./shared-CUtlsTz7.mjs";
//#region src/index.node.d.ts
/**
 * Some tricks for both identifiable for UnoCSS IDE integration for previewing colors
 * and for UnoCSS playground to be able to use this preset.
 */
declare const presetChromatic: PresetFactory<object, PresetChromaticOptions>;
//#endregion
export { type PresetChromaticOptions, VAR_HUE, presetChromatic as default, presetChromatic };