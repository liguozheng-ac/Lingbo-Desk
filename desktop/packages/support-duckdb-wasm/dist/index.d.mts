import { AsyncDuckDB, AsyncDuckDBConnection, DuckDBAccessMode, DuckDBBundles, Logger } from "@duckdb/duckdb-wasm";
import { DataType as ArrowDataType, Dictionary, Field, Field as ArrowField, Schema, Schema as ArrowSchema, Struct, StructRow, Table as ArrowTable, TypeMap as ArrowTypeMap, Vector } from "apache-arrow";

//#region src/common.d.ts
/**
 * A type predicate that is true if the given value is either undefined
 * or null.
 */
declare function isNullOrUndefined<T>(value: T | null | undefined): value is null | undefined;
/**
 * A type predicate that is true if the given value is neither undefined
 * nor null.
 */
declare function notNullOrUndefined<T>(value: T | null | undefined): value is T;
declare function getEnvironment(): Promise<"browser" | "node" | "unknown">;
//#endregion
//#region src/storage.d.ts
declare enum DBStorageType {
  ORIGIN_PRIVATE_FS = "origin-private-fs",
  NODE_FS = "node-fs"
}
interface PathBasedFS {
  path: string;
  /**
   * DuckDB will use {@link DuckDBAccessMode.READ_ONLY} if omitted.
   */
  accessMode?: DuckDBAccessMode;
}
/**
 * Origin Private FS storage.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
 */
interface DBOriginPrivateFS extends PathBasedFS {
  type: DBStorageType.ORIGIN_PRIVATE_FS;
  /**
   * Path of the file in the Origin Private FS.
   *
   * Leading slash is not necessary and will be omitted if provided.
   */
  path: PathBasedFS['path'];
}
interface DBNodeFS extends PathBasedFS {
  type: DBStorageType.NODE_FS;
}
type DBStorage = DBOriginPrivateFS | DBNodeFS;
//#endregion
//#region src/duckdb.d.ts
type ConnectOptions = ConnectRequiredOptions & ConnectOptionalOptions;
interface ConnectOptionalOptions extends Record<string, unknown> {
  bundles?: DuckDBBundles | Promise<DuckDBBundles>;
  logger?: boolean | Logger;
  storage?: DBStorage;
}
interface ConnectRequiredOptions extends Record<string, unknown> {}
interface ResultColumns<T extends {
  [key: string]: ArrowDataType;
} = any, D extends ArrowTypeMap = any, R = Record<string, unknown>> {
  _results: ArrowTable<T>;
  _schema: ArrowSchema<D>;
  columns: ArrowField<D[keyof D]>[];
  rows: R[];
}
interface DuckDBWasmClient<T extends {
  [key: string]: ArrowDataType;
} = any, D extends ArrowTypeMap = any, R = Record<string, unknown>> {
  worker: Worker;
  db: AsyncDuckDB;
  conn: AsyncDuckDBConnection;
  close: () => Promise<void>;
  query: (query: string, params?: unknown[]) => Promise<T[]>;
  queryWithColumns: (query: string, params?: unknown[]) => Promise<ResultColumns<T, D, R>>;
}
declare function connect(options: ConnectOptions): Promise<DuckDBWasmClient>;
declare function beginTransaction(client: Promise<DuckDBWasmClient>, txFn: (client: Promise<DuckDBWasmClient>) => Promise<any>): Promise<any>;
declare function withSavepoint(client: Promise<DuckDBWasmClient>, spName: string, txFn: (client: Promise<DuckDBWasmClient>) => Promise<any>): Promise<any>;
//#endregion
//#region src/types.d.ts
/** Data types used by ArrowJS. */
type DataType = null | boolean | number | string | Date | Int32Array | Uint8Array | Uint32Array | Vector | StructRow | Dictionary | Struct | bigint;
/** The type of the cell. */
declare enum DataFrameCellType {
  INDEX = "index",
  DATA = "data"
}
/**
 * Converts an Arrow vector to a list of strings.
 *
 * @param vector The Arrow vector to convert.
 * @returns The list of strings.
 */
declare function convertVectorToList(vector: Vector<any>): string[];
/** Returns the timezone of the arrow type metadata. */
declare function getTimezone(field: Field): string | undefined;
/**
 * True if the arrow type is an integer type.
 * For example: int8, int16, int32, int64, uint8, uint16, uint32, uint64, range
 */
declare function isIntegerType(field?: Field): boolean;
/** True if the arrow type is an unsigned integer type. */
declare function isUnsignedIntegerType(field?: Field): boolean;
/**
 * True if the arrow type is a float type.
 * For example: float16, float32, float64, float96, float128
 */
declare function isFloatType(field?: Field): boolean;
/** True if the arrow type is a decimal type. */
declare function isDecimalType(field?: Field): boolean;
/** True if the arrow type is a numeric type. */
declare function isNumericType(type?: Field): boolean;
/** True if the arrow type is a boolean type. */
declare function isBooleanType(type?: Field): boolean;
/** True if the arrow type is a duration type. */
declare function isDurationType(type?: Field): boolean;
/** True if the arrow type is a period type. */
declare function isPeriodType(type?: Field): boolean;
/** True if the arrow type is a datetime type. */
declare function isDatetimeType(type?: Field): boolean;
/** True if the arrow type is a date type. */
declare function isDateType(type?: Field): boolean;
/** True if the arrow type is a time type. */
declare function isTimeType(type?: Field): boolean;
/** True if the arrow type is a categorical type. */
declare function isCategoricalType(type?: Field): boolean;
/** True if the arrow type is a list type. */
declare function isListType(type?: Field): boolean;
/** True if the arrow type is an object type. */
declare function isObjectType(type?: Field): boolean;
/** True if the arrow type is a bytes type. */
declare function isBytesType(type?: Field): boolean;
/** True if the arrow type is a string type. */
declare function isStringType(type?: Field): boolean;
/** True if the arrow type is an empty type. */
declare function isEmptyType(type?: Field): boolean;
/** True if the arrow type is a interval type. */
declare function isIntervalType(type?: Field): boolean;
//#endregion
//#region src/format.d.ts
/**
 * The frequency strings defined in pandas.
 * See: https://pandas.pydata.org/docs/user_guide/timeseries.html#period-aliases
 * Not supported: "N" (nanoseconds), "U" & "us" (microseconds), and "B" (business days).
 * Reason is that these types are not supported by moment.js, but also they are not
 * very commonly used in practice.
 */
type SupportedPandasOffsetType = 'A' | 'Y' | 'Q' | 'M' | 'W' | 'D' | 'H' | 'h' | 'T' | 'min' | 'S' | 's' | 'L' | 'ms';
type PandasPeriodFrequency = SupportedPandasOffsetType | `${SupportedPandasOffsetType}-${string}`;
/**
 * Converts a UTC time value (timestamp) to a date object.
 *
 * @param timestamp The timestamp to convert.
 * @param field The field containing the unit information.
 * @returns The date object in UTC timezone.
 */
declare function convertTimeToDate(timestamp: number | bigint, field?: Field): Date;
/**
 * Formats a duration value based on the unit information in the field.
 *
 * @param duration The duration value to format.
 * @param field The field containing the unit information.
 * @returns The formatted duration value.
 */
declare function formatDuration(duration: number | bigint, field?: Field): string;
/**
 * Formats a time value based on the unit information in the field.
 *
 * @param timestamp The time value to format.
 * @param field The field containing the unit information.
 * @returns The formatted time value.
 */
declare function formatTime(timestamp: number | bigint, field?: Field): string;
declare function formatDate(date: number | Date): string;
/**
 * Format datetime value from Arrow to string.
 */
declare function formatDatetime(date: number | Date, field?: Field): Date | null;
/**
 * Formats a decimal value with a given scale to a string.
 *
 * This code is partly based on: https://github.com/apache/arrow/issues/35745
 *
 * TODO: This is only a temporary workaround until ArrowJS can format decimals correctly.
 * This is tracked here:
 * https://github.com/apache/arrow/issues/37920
 * https://github.com/apache/arrow/issues/28804
 * https://github.com/apache/arrow/issues/35745
 */
declare function formatDecimal(value: Uint32Array | Int32Array, field?: Field): string;
/**
 * Formats a float value to a string.
 *
 * @param num The float value to format.
 * @returns The formatted float value.
 */
declare function formatFloat(num: number): string;
/**
 * Formats an interval value from arrow to string.
 */
declare function formatInterval(x: DataType, field?: Field): string;
declare function formatPeriodFromFreq(duration: number | bigint, freq: PandasPeriodFrequency): string;
declare function formatPeriod(duration: number | bigint, field?: Field): string;
/**
 * Formats nested arrays and other objects to a JSON string.
 *
 * @param object The value to format.
 * @param field The field metadata from arrow containing metadata about the column.
 * @returns The formatted JSON string.
 */
declare function formatObject(object: any, field?: Field): unknown;
/**
 * Takes the cell data and type metadata from arrow and nicely formats it into a human-readable string.
 *
 * This is mostly a best-effort logic and should not throw exceptions in case of unknown values
 * or other issues. This makes it easier to use this method by consumers (table, dataframe) since
 * they would have to somehow deal with the exception on a cell level to not crash the full table or app.
 *
 * @param x The cell value.
 * @param field The field metadata from arrow containing metadata about the column.
 * @returns The formatted cell value.
 */
declare function mapColumnData<T = unknown>(x: DataType, field?: Field): T;
declare function mapStructRowData<T extends {
  toArray: () => StructRow[];
  schema: Schema;
}>(results: T): {
  [x: string]: any;
}[];
//#endregion
export { type ArrowDataType, type ArrowField, type ArrowSchema, type ArrowTable, type ArrowTypeMap, ConnectOptionalOptions, ConnectOptions, ConnectRequiredOptions, DBNodeFS, DBOriginPrivateFS, DBStorage, DBStorageType, DataFrameCellType, DataType, DuckDBAccessMode, DuckDBWasmClient, ResultColumns, beginTransaction, connect, convertTimeToDate, convertVectorToList, formatDate, formatDatetime, formatDecimal, formatDuration, formatFloat, formatInterval, formatObject, formatPeriod, formatPeriodFromFreq, formatTime, getEnvironment, getTimezone, isBooleanType, isBytesType, isCategoricalType, isDateType, isDatetimeType, isDecimalType, isDurationType, isEmptyType, isFloatType, isIntegerType, isIntervalType, isListType, isNullOrUndefined, isNumericType, isObjectType, isPeriodType, isStringType, isTimeType, isUnsignedIntegerType, mapColumnData, mapStructRowData, notNullOrUndefined, withSavepoint };
//# sourceMappingURL=index.d.mts.map