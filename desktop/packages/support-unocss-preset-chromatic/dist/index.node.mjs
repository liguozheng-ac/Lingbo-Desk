import { n as createPresetChromatic, t as VAR_HUE } from "./shared-C2V85YHh.mjs";
import { env } from "node:process";
//#region src/index.node.ts
/**
* Some tricks for both identifiable for UnoCSS IDE integration for previewing colors
* and for UnoCSS playground to be able to use this preset.
*/
const presetChromatic = createPresetChromatic((env.VSCODE_ESM_ENTRYPOINT ?? "").includes("extensionHostProcess"));
//#endregion
export { VAR_HUE, presetChromatic as default, presetChromatic };
