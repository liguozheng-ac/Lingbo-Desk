import ehMainWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import ehMainModule from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import mvpMainWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import mvpMainModule from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import coiMainModule from "@duckdb/duckdb-wasm/dist/duckdb-coi.wasm?url";
import coiMainWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-coi.worker.js?url";
import coiPthreadWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-coi.pthread.worker.js?url";
//#region src/bundles/import-url-browser.ts
function getImportUrlBundles() {
	return {
		mvp: {
			mainModule: mvpMainModule,
			mainWorker: mvpMainWorker
		},
		eh: {
			mainModule: ehMainModule,
			mainWorker: ehMainWorker
		},
		coi: {
			mainModule: coiMainModule,
			mainWorker: coiMainWorker,
			pthreadWorker: coiPthreadWorker
		}
	};
}
//#endregion
export { getImportUrlBundles };

//# sourceMappingURL=import-url-browser.mjs.map