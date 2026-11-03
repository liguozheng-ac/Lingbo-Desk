import { AsyncDuckDB, ConsoleLogger, DuckDBAccessMode, VoidLogger, selectBundle } from "@duckdb/duckdb-wasm";
import { defu } from "defu";
import { TZDateMini } from "@date-fns/tz";
import { DataType, Struct, TimeUnit, util } from "apache-arrow";
import { addDays, addHours, addMilliseconds, addMinutes, addMonths, addQuarters, addSeconds, addWeeks, addYears, format, formatDuration as formatDuration$1, fromUnixTime, setDay, transpose } from "date-fns";
import { trimEnd } from "es-toolkit";
//#region src/common.ts
/**
* A type predicate that is true if the given value is either undefined
* or null.
*/
function isNullOrUndefined(value) {
	return value === null || value === void 0;
}
/**
* A type predicate that is true if the given value is neither undefined
* nor null.
*/
function notNullOrUndefined(value) {
	return value !== null && value !== void 0;
}
async function getEnvironment() {
	if (typeof window !== "undefined" && window !== null) return "browser";
	try {
		const process = await import("node:process");
		if (typeof process !== "undefined" && process.versions != null && process.versions.node != null) return "node";
		return "unknown";
	} catch {
		return "unknown";
	}
}
//#endregion
//#region src/types.ts
/** The type of the cell. */
let DataFrameCellType = /* @__PURE__ */ function(DataFrameCellType) {
	DataFrameCellType["INDEX"] = "index";
	DataFrameCellType["DATA"] = "data";
	return DataFrameCellType;
}({});
/**
* Converts an Arrow vector to a list of strings.
*
* @param vector The Arrow vector to convert.
* @returns The list of strings.
*/
function convertVectorToList(vector) {
	const values = [];
	for (let i = 0; i < vector.length; i++) values.push(vector.get(i));
	return values;
}
/** Returns the timezone of the arrow type metadata. */
function getTimezone(field) {
	return field.type?.timezone ?? field.metadata?.get("timezone");
}
/**
* True if the arrow type is an integer type.
* For example: int8, int16, int32, int64, uint8, uint16, uint32, uint64, range
*/
function isIntegerType(field) {
	if (isNullOrUndefined(field)) return false;
	return DataType.isInt(field.type) && !isPeriodType(field) || isUnsignedIntegerType(field);
}
/** True if the arrow type is an unsigned integer type. */
function isUnsignedIntegerType(field) {
	if (isNullOrUndefined(field)) return false;
	return DataType.isInt(field.type) && field.type.isSigned === false;
}
/**
* True if the arrow type is a float type.
* For example: float16, float32, float64, float96, float128
*/
function isFloatType(field) {
	if (isNullOrUndefined(field)) return false;
	return DataType.isFloat(field.type) ?? false;
}
/** True if the arrow type is a decimal type. */
function isDecimalType(field) {
	if (isNullOrUndefined(field)) return false;
	return DataType.isDecimal(field.type);
}
/** True if the arrow type is a numeric type. */
function isNumericType(type) {
	if (isNullOrUndefined(type)) return false;
	return isIntegerType(type) || isFloatType(type) || isDecimalType(type);
}
/** True if the arrow type is a boolean type. */
function isBooleanType(type) {
	if (isNullOrUndefined(type)) return false;
	return DataType.isBool(type.type);
}
/** True if the arrow type is a duration type. */
function isDurationType(type) {
	if (isNullOrUndefined(type)) return false;
	return DataType.isDuration(type.type);
}
/** True if the arrow type is a period type. */
function isPeriodType(type) {
	if (isNullOrUndefined(type)) return false;
	return DataType.isInt(type.type) && type.metadata.get("ARROW:extension:name") === "period";
}
/** True if the arrow type is a datetime type. */
function isDatetimeType(type) {
	if (isNullOrUndefined(type)) return false;
	return DataType.isTimestamp(type.type);
}
/** True if the arrow type is a date type. */
function isDateType(type) {
	if (isNullOrUndefined(type)) return false;
	return DataType.isDate(type.type);
}
/** True if the arrow type is a time type. */
function isTimeType(type) {
	if (isNullOrUndefined(type)) return false;
	return DataType.isTime(type.type);
}
/** True if the arrow type is a categorical type. */
function isCategoricalType(type) {
	if (isNullOrUndefined(type)) return false;
	return DataType.isDictionary(type.type);
}
/** True if the arrow type is a list type. */
function isListType(type) {
	if (isNullOrUndefined(type)) return false;
	return DataType.isList(type.type) || DataType.isFixedSizeList(type.type);
}
/** True if the arrow type is an object type. */
function isObjectType(type) {
	if (isNullOrUndefined(type)) return false;
	return DataType.isStruct(type.type) || DataType.isMap(type.type);
}
/** True if the arrow type is a bytes type. */
function isBytesType(type) {
	if (isNullOrUndefined(type)) return false;
	return DataType.isBinary(type.type) || DataType.isLargeBinary(type.type);
}
/** True if the arrow type is a string type. */
function isStringType(type) {
	if (isNullOrUndefined(type)) return false;
	return DataType.isUtf8(type.type) || DataType.isLargeUtf8(type.type);
}
/** True if the arrow type is an empty type. */
function isEmptyType(type) {
	if (isNullOrUndefined(type)) return false;
	return DataType.isNull(type.type);
}
/** True if the arrow type is a interval type. */
function isIntervalType(type) {
	if (isNullOrUndefined(type)) return false;
	return DataType.isStruct(type.type) && type.metadata.get("ARROW:extension:name") === "interval" || DataType.isInterval(type.type);
}
//#endregion
//#region src/format.ts
const BASE_DATE = new Date(1970, 0, 1);
function formatMs(duration) {
	return format(addMilliseconds(BASE_DATE, duration), "yyyy-MM-dd HH:mm:ss.SSS");
}
function formatSec(duration) {
	return format(addSeconds(BASE_DATE, duration), "yyyy-MM-dd HH:mm:ss");
}
function formatMin(duration) {
	return format(addMinutes(BASE_DATE, duration), "yyyy-MM-dd HH:mm");
}
function formatHours(duration) {
	return format(addHours(BASE_DATE, duration), "yyyy-MM-dd HH:mm");
}
function formatDay(duration) {
	return format(addDays(BASE_DATE, duration), "yyyy-MM-dd");
}
function formatMonth(duration) {
	return format(addMonths(BASE_DATE, duration), "yyyy-MM");
}
function formatYear(duration) {
	return format(addYears(BASE_DATE, duration), "yyyy");
}
function formatWeeks(duration, freqParam) {
	if (!freqParam) throw new Error("Frequency \"W\" requires parameter");
	const WEEKDAY_SHORT = [
		"SUN",
		"MON",
		"TUE",
		"WED",
		"THU",
		"FRI",
		"SAT"
	];
	const dayIndex = WEEKDAY_SHORT.indexOf(freqParam);
	if (dayIndex < 0) throw new Error(`Invalid value: ${freqParam}. Supported values: ${JSON.stringify(WEEKDAY_SHORT)}`);
	const weekDate = addWeeks(BASE_DATE, duration);
	return `${format(setDay(weekDate, dayIndex - 6), "yyyy-MM-dd")}/${format(setDay(weekDate, dayIndex), "yyyy-MM-dd")}`;
}
function formatQuarter(duration) {
	const date = addQuarters(BASE_DATE, duration);
	return `${format(date, "yyyy")}Q${Math.floor(date.getMonth() / 3) + 1}`;
}
/**
* Formatters for the different pandas period frequencies.
*
* This is a mapping from the frequency strings to the function that formats the period.
*/
const PERIOD_TYPE_FORMATTERS = {
	L: formatMs,
	ms: formatMs,
	S: formatSec,
	s: formatSec,
	T: formatMin,
	min: formatMin,
	H: formatHours,
	h: formatHours,
	D: formatDay,
	M: formatMonth,
	W: formatWeeks,
	Q: formatQuarter,
	Y: formatYear,
	A: formatYear
};
/**
* Adjusts a time value to seconds based on the unit information in the field.
*
* The unit numbers are specified here:
* https://github.com/apache/arrow/blob/3ab246f374c17a216d86edcfff7ff416b3cff803/js/src/enum.ts#L95
*
* @param timestamp The timestamp to convert.
* @param unit The unit of the timestamp. 0 is seconds, 1 is milliseconds, 2 is microseconds, 3 is nanoseconds.
* @returns The timestamp in seconds.
*/
function convertTimestampToSeconds(timestamp, unit) {
	let unitAdjustment;
	if (unit === TimeUnit.MILLISECOND) unitAdjustment = 1e3;
	else if (unit === TimeUnit.MICROSECOND) unitAdjustment = 1e3 * 1e3;
	else if (unit === TimeUnit.NANOSECOND) unitAdjustment = 1e3 * 1e3 * 1e3;
	else return Number(timestamp);
	if (typeof timestamp === "bigint" && !Number.isSafeInteger(Number(timestamp))) return Number(timestamp / BigInt(unitAdjustment));
	return Number(timestamp) / unitAdjustment;
}
/**
* Converts a UTC time value (timestamp) to a date object.
*
* @param timestamp The timestamp to convert.
* @param field The field containing the unit information.
* @returns The date object in UTC timezone.
*/
function convertTimeToDate(timestamp, field) {
	return fromUnixTime(convertTimestampToSeconds(timestamp, field?.type?.unit ?? TimeUnit.SECOND));
}
/**
* Formats a duration value based on the unit information in the field.
*
* @param duration The duration value to format.
* @param field The field containing the unit information.
* @returns The formatted duration value.
*/
function formatDuration(duration, field) {
	return formatDuration$1({ seconds: convertTimestampToSeconds(duration, field?.type?.unit ?? TimeUnit.NANOSECOND) });
}
/**
* Formats a time value based on the unit information in the field.
*
* @param timestamp The time value to format.
* @param field The field containing the unit information.
* @returns The formatted time value.
*/
function formatTime(timestamp, field) {
	const date = convertTimeToDate(timestamp, field);
	return format(date, date.getMilliseconds() === 0 ? "HH:mm:ss" : "HH:mm:ss.SSS");
}
function formatDate(date) {
	const formatPattern = "yyyy-MM-dd";
	if (!(date instanceof Date || typeof date === "number" && Number.isFinite(date))) {
		console.warn(`Unsupported date value: ${date}`);
		return String(date);
	}
	return format(date, formatPattern);
}
/**
* Format datetime value from Arrow to string.
*/
function formatDatetime(date, field) {
	if (!(date instanceof Date || typeof date === "number" && Number.isFinite(date))) {
		console.warn(`Unsupported datetime value: ${date}`);
		return null;
	}
	let datetime;
	const timezone = field?.type?.timezone;
	if (typeof date === "number") if (timezone) datetime = new TZDateMini(date, timezone);
	else datetime = new TZDateMini(date);
	else if (timezone) datetime = new TZDateMini(date, timezone);
	else datetime = new TZDateMini(date);
	return transpose(datetime, Date);
}
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
function formatDecimal(value, field) {
	const scale = field?.type?.scale || 0;
	let numString = util.bigNumToString(new util.BN(value)).padStart(scale, "0");
	if (scale === 0) return numString;
	let sign = "";
	if (numString.startsWith("-")) {
		sign = "-";
		numString = numString.slice(1);
	}
	const wholePart = numString.slice(0, -scale) || "0";
	const decimalPart = trimEnd(numString.slice(-scale), "0") || "";
	return `${sign}${wholePart}${decimalPart ? `.${decimalPart}` : ""}`;
}
const formatter = new Intl.NumberFormat("en-US", {
	style: "decimal",
	maximumFractionDigits: 4,
	minimumFractionDigits: 4,
	useGrouping: true
});
/**
* Formats a float value to a string.
*
* @param num The float value to format.
* @returns The formatted float value.
*/
function formatFloat(num) {
	if (!Number.isFinite(num)) return String(num);
	return formatter.format(num);
}
function parseInterval(arr) {
	const years = arr[0];
	const months = arr[1];
	const result = [];
	if (years !== 0) result.push(`${years} year${years > 1 ? "s" : ""}`);
	if (months !== 0) result.push(`${months} month${months > 1 ? "s" : ""}`);
	return result.length ? result.join(" ") : "0 months";
}
/**
* Formats an interval value from arrow to string.
*/
function formatInterval(x, field) {
	if (DataType.isInterval(field?.type)) return parseInterval(x);
	const extensionName = field && field.metadata.get("ARROW:extension:name");
	if (extensionName && extensionName === "pandas.interval") {
		const { closed } = JSON.parse(field.metadata.get("ARROW:extension:metadata"));
		const interval = x.toJSON();
		const leftBracket = closed === "both" || closed === "left" ? "[" : "(";
		const rightBracket = closed === "both" || closed === "right" ? "]" : ")";
		const leftInterval = mapColumnData(interval.left, field.type?.children?.[0]);
		const rightInterval = mapColumnData(interval.right, field.type?.children?.[1]);
		return `${leftBracket + leftInterval}, ${rightInterval + rightBracket}`;
	}
	return String(x);
}
function formatPeriodFromFreq(duration, freq) {
	const [freqName, freqParam] = freq.split("-", 2);
	const momentConverter = PERIOD_TYPE_FORMATTERS[freqName];
	if (!momentConverter) {
		console.warn(`Unsupported period frequency: ${freq}`);
		return String(duration);
	}
	const durationNumber = Number(duration);
	if (!Number.isSafeInteger(durationNumber)) {
		console.warn(`Unsupported value: ${duration}. Supported values: [${Number.MIN_SAFE_INTEGER}-${Number.MAX_SAFE_INTEGER}]`);
		return String(duration);
	}
	return momentConverter(durationNumber, freqParam);
}
function formatPeriod(duration, field) {
	if (isNullOrUndefined(field)) {
		console.warn("Field information is missing");
		return String(duration);
	}
	const extensionName = field.metadata.get("ARROW:extension:name");
	const extensionMetadata = field.metadata.get("ARROW:extension:metadata");
	if (isNullOrUndefined(extensionName) || isNullOrUndefined(extensionMetadata)) {
		console.warn("Arrow extension metadata is missing");
		return String(duration);
	}
	if (extensionName !== "pandas.period") {
		console.warn(`Unsupported extension name for period type: ${extensionName}`);
		return String(duration);
	}
	const { freq } = JSON.parse(extensionMetadata);
	return formatPeriodFromFreq(duration, freq);
}
/**
* Formats nested arrays and other objects to a JSON string.
*
* @param object The value to format.
* @param field The field metadata from arrow containing metadata about the column.
* @returns The formatted JSON string.
*/
function formatObject(object, field) {
	if (field?.type instanceof Struct) return JSON.parse(JSON.stringify(object, (_key, value) => {
		if (!notNullOrUndefined(value)) return;
		if (typeof value === "bigint") return Number(value);
		return value;
	}));
	return JSON.parse(JSON.stringify(object, (_key, value) => typeof value === "bigint" ? Number(value) : value));
}
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
function mapColumnData(x, field) {
	if (isNullOrUndefined(x)) return null;
	const isDate = x instanceof Date || Number.isFinite(x);
	if (isDate && isDateType(field)) return formatDate(x);
	if (typeof x === "bigint" && isTimeType(field)) return formatTime(Number(x), field);
	if (isDate && isDatetimeType(field)) return formatDatetime(x, field);
	if (isPeriodType(field)) throw new Error("Period type is not supported yet");
	if (isIntervalType(field)) return formatInterval(x, field);
	if (isDurationType(field)) throw new Error("Duration type is not supported yet");
	if (isDecimalType(field)) return formatDecimal(x, field);
	if (isFloatType(field) && Number.isFinite(x)) return x;
	if (isIntegerType(field)) return x;
	if (isObjectType(field) || isListType(field)) return formatObject(x, field);
	if (isBooleanType(field)) return Boolean(x);
	return String(x);
}
function mapStructRowData(results) {
	return ((results.toArray() || []).map((item) => item.toJSON()) || []).map((row) => {
		results.schema.fields.forEach((field) => {
			return row[field.name] = mapColumnData(row[field.name], field);
		});
		return row;
	});
}
//#endregion
//#region src/storage.ts
let DBStorageType = /* @__PURE__ */ function(DBStorageType) {
	DBStorageType["ORIGIN_PRIVATE_FS"] = "origin-private-fs";
	DBStorageType["NODE_FS"] = "node-fs";
	return DBStorageType;
}({});
//#endregion
//#region src/duckdb.ts
async function connect(options) {
	const opts = defu(options, { logger: false });
	let worker;
	let bundle;
	const env = await getEnvironment();
	if (env === "browser") {
		if (typeof opts.bundles === "undefined") {
			const { getBundles } = await import("./bundles/default-browser.mjs");
			opts.bundles = await getBundles();
		}
		bundle = await selectBundle(await opts.bundles);
		worker = new Worker(bundle.mainWorker);
	} else if (env === "node") {
		if (typeof opts.bundles === "undefined") {
			const { getBundles } = await import("./bundles/default-node.mjs");
			opts.bundles = await getBundles();
		}
		bundle = await selectBundle(await opts.bundles);
		let workerUrl = bundle.mainWorker;
		if (workerUrl.startsWith("/@fs/")) workerUrl = workerUrl.replace("/@fs/", "file://");
		worker = new (await (import("web-worker"))).default(workerUrl, { type: "module" });
	} else throw new Error(`Unsupported environment: ${env}`);
	let logger;
	if (opts.logger === true) logger = new ConsoleLogger();
	else if (opts.logger === false) logger = new VoidLogger();
	else logger = opts.logger || new ConsoleLogger();
	const db = new AsyncDuckDB(logger, worker);
	await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
	if (opts.storage) switch (opts.storage.type) {
		case "origin-private-fs":
			try {
				let strippedPath = opts.storage.path;
				if (strippedPath.startsWith("/")) strippedPath = strippedPath.slice(1);
				await db.open({
					path: `opfs://${strippedPath}`,
					accessMode: opts.storage.accessMode
				});
			} catch (e) {
				await db.terminate();
				await worker.terminate();
				throw e;
			}
			break;
		case "node-fs":
			try {
				await db.open({
					path: opts.storage.path,
					accessMode: opts.storage.accessMode,
					useDirectIO: true
				});
			} catch (e) {
				await db.terminate();
				await worker.terminate();
				throw e;
			}
			break;
	}
	const conn = await db.connect();
	async function queryWithColumns(query, params = []) {
		if (!params || params.length === 0) {
			const results = await conn.query(query);
			return {
				_results: results,
				_schema: results.schema,
				columns: results.schema.fields,
				rows: mapStructRowData(results)
			};
		}
		const stmt = await conn.prepare(query);
		const results = await stmt.query(...params);
		stmt.close();
		return {
			_results: results,
			_schema: results.schema,
			columns: results.schema.fields,
			rows: mapStructRowData(results)
		};
	}
	return {
		worker,
		db,
		conn,
		query: async (query, params = []) => queryWithColumns(query, params).then((res) => res.rows),
		queryWithColumns: async (query, params = []) => queryWithColumns(query, params),
		close: async () => {
			await conn.close();
			await db.terminate();
			await worker.terminate();
		}
	};
}
async function beginTransaction(client, txFn) {
	await (await client).conn.send("BEGIN TRANSACTION");
	try {
		const result = await txFn(client);
		await (await client).conn.send("COMMIT");
		return result;
	} catch (err) {
		await (await client).conn.send("ROLLBACK");
		throw err;
	}
}
async function withSavepoint(client, spName, txFn) {
	await (await client).conn.send(`SAVEPOINT ${spName}`);
	try {
		const result = await txFn(client);
		await (await client).conn.send(`RELEASE SAVEPOINT ${spName}`);
		return result;
	} catch (err) {
		await (await client).conn.send(`ROLLBACK TO SAVEPOINT ${spName}`);
		throw err;
	}
}
//#endregion
export { DBStorageType, DataFrameCellType, DuckDBAccessMode, beginTransaction, connect, convertTimeToDate, convertVectorToList, formatDate, formatDatetime, formatDecimal, formatDuration, formatFloat, formatInterval, formatObject, formatPeriod, formatPeriodFromFreq, formatTime, getEnvironment, getTimezone, isBooleanType, isBytesType, isCategoricalType, isDateType, isDatetimeType, isDecimalType, isDurationType, isEmptyType, isFloatType, isIntegerType, isIntervalType, isListType, isNullOrUndefined, isNumericType, isObjectType, isPeriodType, isStringType, isTimeType, isUnsignedIntegerType, mapColumnData, mapStructRowData, notNullOrUndefined, withSavepoint };

//# sourceMappingURL=index.mjs.map