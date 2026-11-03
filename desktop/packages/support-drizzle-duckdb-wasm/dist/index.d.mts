import { a as DuckDBWASMSessionOptions, c as DuckDBWasmTransaction, i as DuckDBWASMPreparedQuery, l as Row, n as DuckDBWasmDrizzleDatabase, o as DuckDBWasmQueryResultHKT, r as drizzle, s as DuckDBWasmSession, t as DuckDBWasmDatabase, u as RowList } from "./driver-CSDxAUxK.mjs";
import { AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger, DuckDBBundles, Logger, VoidLogger, getJsDelivrBundles, selectBundle } from "@duckdb/duckdb-wasm";
import { ArrowDataType, ArrowField, ArrowSchema, ArrowTable, ArrowTypeMap, ConnectOptionalOptions, ConnectOptions, ConnectRequiredOptions, DBNodeFS, DBOriginPrivateFS, DBStorage, DBStorage as DBStorage$1, DBStorageType, DataFrameCellType, DataType, DuckDBAccessMode, DuckDBWasmClient, ResultColumns, connect, getEnvironment, mapColumnData, mapStructRowData, withSavepoint } from "@lingbo/duckdb-wasm";

//#region src/dsn.d.ts
interface StructuredDSN {
  scheme: 'duckdb-wasm:';
  bundles?: 'import-url';
  logger?: boolean;
  storage?: DBStorage$1;
}
declare function isLiterallyTrue(value?: string): boolean;
/**
 * Parse a DuckDB WASM DSN string into a structured object
 *
 * Examples:
 * - `duckdb-wasm:///` -> In-memory
 * - `duckdb-wasm:///?bundles=import-url` -> In-memory, use import-URL bundles
 * - `duckdb-wasm:///?logger=true` -> In-memory, enable logger
 * - `duckdb-wasm://database.db?storage=origin-private-fs&write=true` -> Origin Private FS, RW, database.db
 * - `duckdb-wasm:///database.db?storage=origin-private-fs&write=true` -> Origin Private FS, RW, database.db (leading slash is optional)
 *
 * @param dsn The DSN string to parse
 */
declare function parseDSN(dsn: string): StructuredDSN;
/**
 * Build a DuckDB WASM DSN string from a structured DSN object
 *
 * @param structured The structured DSN object
 * @returns The DSN string
 */
declare function buildDSN(structured: StructuredDSN): string;
//#endregion
export { type ArrowDataType, type ArrowField, type ArrowSchema, type ArrowTable, type ArrowTypeMap, AsyncDuckDB, type AsyncDuckDBConnection, type ConnectOptionalOptions, type ConnectOptions, type ConnectRequiredOptions, ConsoleLogger, type DBNodeFS, type DBOriginPrivateFS, type DBStorage, DBStorageType, DataFrameCellType, type DataType, DuckDBAccessMode, type DuckDBBundles, DuckDBWASMPreparedQuery, DuckDBWASMSessionOptions, type DuckDBWasmClient, DuckDBWasmDatabase, DuckDBWasmDrizzleDatabase, DuckDBWasmQueryResultHKT, DuckDBWasmSession, DuckDBWasmTransaction, type Logger, type ResultColumns, Row, RowList, StructuredDSN, VoidLogger, buildDSN, connect, drizzle, getEnvironment, getJsDelivrBundles, isLiterallyTrue, mapColumnData, mapStructRowData, parseDSN, selectBundle, withSavepoint };
//# sourceMappingURL=index.d.mts.map