import { Buffer } from "node:buffer";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { ofetch } from "ofetch";
import { createLogger } from "vite";
//#region src/utils/fs.ts
async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isENOENTError(error)) return false;
		throw error;
	}
}
function isENOENTError(error) {
	if (!(error instanceof Error)) return false;
	if (!("code" in error)) return false;
	if (error.code !== "ENOENT") return false;
	return true;
}
//#endregion
//#region src/vite/index.ts
function Download(url, filename, destination, options) {
	return {
		name: `unplugin-fetch-${filename}`,
		async configResolved(config) {
			const logger = createLogger();
			const cacheDirOption = options?.cacheDir ?? ".cache";
			const parentDirOption = options?.parentDir ?? config.publicDir ?? config.root;
			const cacheDir = isAbsolute(cacheDirOption) ? cacheDirOption : resolve(config.root, cacheDirOption);
			const parentDir = parentDirOption === false ? config.root : isAbsolute(parentDirOption) ? parentDirOption : resolve(config.root, parentDirOption);
			try {
				if (await exists(resolve(join(cacheDir, destination, filename)))) logger.info(`${filename} already exists in cache.`);
				else {
					logger.info(`Downloading ${filename}...`);
					const stream = await ofetch(url, { responseType: "arrayBuffer" });
					await mkdir(join(cacheDir, destination), { recursive: true });
					await writeFile(join(cacheDir, destination, filename), Buffer.from(stream));
					logger.info(`${filename} downloaded.`);
				}
				if (await exists(resolve(join(parentDir, destination, filename)))) {
					logger.info(`${filename} already exists in ${parentDir}.`);
					return;
				}
				await mkdir(join(parentDir, destination), { recursive: true }).catch(() => {});
				await copyFile(join(cacheDir, destination, filename), join(parentDir, destination, filename));
				logger.info(`${filename} copied to ${parentDir}.`);
			} catch (err) {
				console.error(err);
				throw err;
			}
		}
	};
}
//#endregion
export { Download };

//# sourceMappingURL=index.mjs.map