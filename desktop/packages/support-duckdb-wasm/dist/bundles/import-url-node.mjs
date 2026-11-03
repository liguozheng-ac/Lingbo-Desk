import ehMainModule from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import mvpMainModule from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import ehMainWorker from "@duckdb/duckdb-wasm/dist/duckdb-node-eh.worker.cjs?url";
import mvpMainWorker from "@duckdb/duckdb-wasm/dist/duckdb-node-mvp.worker.cjs?url";
//#region src/bundles/import-url-node.ts
function transformUrl(url) {
	if (url.startsWith("/@fs/")) return url.replace("/@fs/", "file://");
	return url;
}
async function getImportUrlBundles() {
	return {
		mvp: {
			mainModule: transformUrl(mvpMainModule),
			mainWorker: transformUrl(mvpMainWorker)
		},
		eh: {
			mainModule: transformUrl(ehMainModule),
			mainWorker: transformUrl(ehMainWorker)
		}
	};
}
//#endregion
export { getImportUrlBundles };

//# sourceMappingURL=import-url-node.mjs.map