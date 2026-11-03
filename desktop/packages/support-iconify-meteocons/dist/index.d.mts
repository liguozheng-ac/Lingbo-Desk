import chars from "./chars.json";
import { IconifyInfo, IconifyJSON, IconifyMetaData } from "@iconify/types";

//#region src/icons.d.ts
declare const icons: IconifyJSON;
//#endregion
//#region src/info.d.ts
declare const info: IconifyInfo;
//#endregion
//#region src/metadata.d.ts
declare const metadata: IconifyMetaData;
//#endregion
export { chars, icons, info, metadata };