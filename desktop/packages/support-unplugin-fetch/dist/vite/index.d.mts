import { Plugin } from "vite";

//#region src/vite/index.d.ts
declare function Download(url: string, filename: string, destination: string, options?: {
  /**
   * @default '.cache'
   */
  cacheDir?: string;
  /**
   * @default 'public' or `config.publicDir`
   */
  parentDir?: false | string;
}): Plugin;
//#endregion
export { Download };
//# sourceMappingURL=index.d.mts.map