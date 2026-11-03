//#region src/bundles/default-browser.ts
function getBundles() {
	return {
		mvp: {
			mainModule: "./duckdb-mvp.wasm",
			mainWorker: "./duckdb-browser-mvp.worker.js"
		},
		eh: {
			mainModule: "./duckdb-eh.wasm",
			mainWorker: "./duckdb-browser-eh.worker.js"
		},
		coi: {
			mainModule: "./duckdb-coi.wasm",
			mainWorker: "./duckdb-browser-coi.worker.js",
			pthreadWorker: "./duckdb-browser-coi.pthread.worker.js"
		}
	};
}
//#endregion
export { getBundles };

//# sourceMappingURL=default-browser.mjs.map