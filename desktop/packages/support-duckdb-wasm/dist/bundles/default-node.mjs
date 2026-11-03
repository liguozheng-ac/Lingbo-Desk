//#region src/bundles/default-node.ts
async function getBundles() {
	const { createRequire } = await import("node:module");
	const { dirname, resolve } = await import("node:path");
	const DUCKDB_DIST = dirname(createRequire(import.meta.url).resolve("@duckdb/duckdb-wasm"));
	return {
		mvp: {
			mainModule: resolve(DUCKDB_DIST, "./duckdb-mvp.wasm"),
			mainWorker: resolve(DUCKDB_DIST, "./duckdb-node-mvp.worker.cjs")
		},
		eh: {
			mainModule: resolve(DUCKDB_DIST, "./duckdb-eh.wasm"),
			mainWorker: resolve(DUCKDB_DIST, "./duckdb-node-eh.worker.cjs")
		}
	};
}
//#endregion
export { getBundles };

//# sourceMappingURL=default-node.mjs.map