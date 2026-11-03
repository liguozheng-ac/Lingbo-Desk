import { AsyncDuckDB, ConsoleLogger, ConsoleLogger as ConsoleLogger$1, DuckDBAccessMode as DuckDBAccessMode$1, VoidLogger, getJsDelivrBundles, selectBundle } from "@duckdb/duckdb-wasm";
import { DBStorageType, DBStorageType as DBStorageType$1, DataFrameCellType, DuckDBAccessMode, beginTransaction, connect, connect as connect$1, getEnvironment, getEnvironment as getEnvironment$1, mapColumnData, mapStructRowData, withSavepoint, withSavepoint as withSavepoint$1 } from "@lingbo/duckdb-wasm";
import { DefaultLogger, NoopLogger, createTableRelationsHelpers, entityKind, extractTablesRelationalConfig, fillPlaceholders, isConfig } from "drizzle-orm";
import { PgDatabase, PgDialect, PgPreparedQuery, PgSession, PgTransaction } from "drizzle-orm/pg-core";
//#region src/dsn.ts
function isLiterallyTrue(value) {
	return typeof value === "string" && /^true$/i.test(value);
}
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
function parseDSN(dsn) {
	const structured = { scheme: "duckdb-wasm:" };
	const parsed = new URL(dsn);
	if (!parsed.protocol.startsWith("duckdb-wasm:")) throw new Error(`Expected scheme to be "duckdb-wasm:" but got "${parsed.protocol}"`);
	if (parsed.searchParams.get("bundles") === "import-url") structured.bundles = "import-url";
	const paramLogger = parsed.searchParams.get("logger");
	if (paramLogger && isLiterallyTrue(paramLogger)) structured.logger = true;
	const paramStorage = parsed.searchParams.get("storage");
	switch (paramStorage) {
		case DBStorageType$1.ORIGIN_PRIVATE_FS: {
			if (parsed.host.length > 0) console.warn(`Host "${parsed.host}" will be ignored while using Origin Private FS`);
			const paramWrite = parsed.searchParams.get("write");
			structured.storage = {
				type: DBStorageType$1.ORIGIN_PRIVATE_FS,
				path: parsed.pathname.startsWith("/") ? parsed.pathname.slice(1) : parsed.pathname,
				...paramWrite && isLiterallyTrue(paramWrite) && { accessMode: DuckDBAccessMode$1.READ_WRITE }
			};
			break;
		}
		case null: break;
		default:
			console.warn(`Unknown storage type "${paramStorage}"`);
			break;
	}
	return structured;
}
/**
* Build a DuckDB WASM DSN string from a structured DSN object
*
* @param structured The structured DSN object
* @returns The DSN string
*/
function buildDSN(structured) {
	const parsed = new URL("duckdb-wasm:///");
	if (structured.bundles === "import-url") parsed.searchParams.set("bundles", "import-url");
	if (structured.logger) parsed.searchParams.set("logger", "true");
	if (structured.storage) {
		parsed.searchParams.set("storage", structured.storage.type);
		switch (structured.storage.type) {
			case DBStorageType$1.ORIGIN_PRIVATE_FS:
				parsed.pathname = structured.storage.path;
				if (!parsed.pathname.startsWith("/")) parsed.pathname = `/${parsed.pathname}`;
				if (structured.storage.accessMode === DuckDBAccessMode$1.READ_WRITE) parsed.searchParams.set("write", "true");
				break;
			case DBStorageType$1.NODE_FS:
				parsed.pathname = structured.storage.path;
				if (structured.storage.accessMode === DuckDBAccessMode$1.READ_WRITE) parsed.searchParams.set("write", "true");
				break;
		}
	}
	return parsed.toString();
}
//#endregion
//#region src/session.ts
var DuckDBWASMPreparedQuery = class extends PgPreparedQuery {
	static [entityKind] = "DuckDBWasmPreparedQuery";
	constructor(client, queryString, params, logger, fields, customResultMapper) {
		super({
			sql: queryString,
			params
		});
		this.client = client;
		this.queryString = queryString;
		this.params = params;
		this.logger = logger;
		this.fields = fields;
		this.customResultMapper = customResultMapper;
	}
	async execute(placeholderValues = {}) {
		const params = fillPlaceholders(this.params, placeholderValues);
		this.logger.logQuery(this.queryString, params);
		const { fields, queryString: query, client, customResultMapper } = this;
		const c = await client;
		if (!fields && !customResultMapper) return c.query(query, params);
		return c.query(query, params);
	}
	async all(placeholderValues = {}) {
		const params = fillPlaceholders(this.params, placeholderValues);
		this.logger.logQuery(this.queryString, params);
		return (await this.client).query(this.queryString, params);
	}
};
var DuckDBWasmSession = class DuckDBWasmSession extends PgSession {
	static [entityKind] = "DuckDBWasmSession";
	logger;
	constructor(client, dialect, schema, options = {}) {
		super(dialect);
		this.client = client;
		this.schema = schema;
		this.options = options;
		this.logger = options.logger ?? new NoopLogger();
	}
	prepareQuery(query, fields, _name, _isResponseInArrayMode, customResultMapper) {
		return new DuckDBWASMPreparedQuery(this.client, query.sql, query.params, this.logger, fields, customResultMapper);
	}
	async query(query, params) {
		this.logger.logQuery(query, params);
		return (await this.client).query(query, params);
	}
	async queryObjects(query, params) {
		this.logger.logQuery(query, params);
		return (await this.client).query(query, params);
	}
	transaction(transaction, config) {
		return beginTransaction(this.client, async (client) => {
			const session = new DuckDBWasmSession(client, this.dialect, this.schema, this.options);
			const tx = new DuckDBWasmTransaction(this.dialect, session, this.schema);
			if (config) await tx.setTransaction(config);
			return transaction(tx);
		});
	}
};
var DuckDBWasmTransaction = class DuckDBWasmTransaction extends PgTransaction {
	static [entityKind] = "DuckDBWasmTransaction";
	dialect;
	session;
	constructor(dialect, session, schema, nestedIndex = 0) {
		super(dialect, session, schema, nestedIndex);
		this.dialect = dialect;
		this.session = session;
	}
	async transaction(transaction) {
		return withSavepoint$1(this.session.client, "", async (client) => {
			const session = new DuckDBWasmSession(client, this.dialect, this.schema, this.session.options);
			return transaction(new DuckDBWasmTransaction(this.dialect, session, this.schema));
		});
	}
};
//#endregion
//#region src/driver.ts
var DuckDBWasmDatabase = class extends PgDatabase {
	static [entityKind] = "DuckDBWasmDatabase";
};
function construct(client, config = {}) {
	const dialect = new PgDialect({ casing: config.casing });
	let logger;
	if (config.logger === true) logger = new DefaultLogger();
	else if (config.logger !== false) logger = config.logger;
	let schema;
	if (config.schema) {
		const tablesConfig = extractTablesRelationalConfig(config.schema, createTableRelationsHelpers);
		schema = {
			fullSchema: config.schema,
			schema: tablesConfig.tables,
			tableNamesMap: tablesConfig.tableNamesMap
		};
	}
	const db = new DuckDBWasmDatabase(dialect, new DuckDBWasmSession(client, dialect, schema, { logger }), schema);
	db.$client = client;
	return db;
}
function constructByDSN(dsn, drizzleConfig) {
	const structured = parseDSN(dsn);
	let bundles;
	if (structured.bundles === "import-url") {
		const getBundles = async () => {
			const env = await getEnvironment$1();
			switch (env) {
				case "browser": return (await import("@lingbo/duckdb-wasm/bundles/import-url-browser")).getImportUrlBundles();
				case "node": return await (await import("@lingbo/duckdb-wasm/bundles/import-url-node")).getImportUrlBundles();
				default: throw new Error(`Unsupported environment: "${env}"`);
			}
		};
		bundles = getBundles();
	} else {
		const getBundles = async () => {
			const env = await getEnvironment$1();
			switch (env) {
				case "browser": return (await import("@lingbo/duckdb-wasm/bundles/default-browser")).getBundles();
				case "node": return await (await import("@lingbo/duckdb-wasm/bundles/default-node")).getBundles();
				default: throw new Error(`Unsupported environment: "${env}"`);
			}
		};
		bundles = getBundles();
	}
	return construct(connect$1({
		bundles,
		logger: structured.logger ? new ConsoleLogger$1() : void 0,
		storage: structured.storage
	}), drizzleConfig);
}
function drizzle(...params) {
	if (typeof params[0] === "string") return constructByDSN(params[0], params[1]);
	if (isConfig(params[0])) {
		const { connection, client, ...drizzleConfig } = params[0];
		if (client) return construct(client, drizzleConfig);
		if (typeof connection === "string") return constructByDSN(connection, drizzleConfig);
		if (typeof connection === "undefined") throw new Error("connection option is required");
		return construct(connect$1({
			bundles: connection.bundles,
			logger: connection.logger,
			storage: connection.storage
		}), drizzleConfig);
	}
	return construct(params[0], params[1]);
}
(function(_drizzle) {
	function mock(config) {
		return construct({ options: {
			parsers: {},
			serializers: {}
		} }, config);
	}
	_drizzle.mock = mock;
})(drizzle || (drizzle = {}));
//#endregion
export { AsyncDuckDB, ConsoleLogger, DBStorageType, DataFrameCellType, DuckDBAccessMode, DuckDBWASMPreparedQuery, DuckDBWasmDatabase, DuckDBWasmSession, DuckDBWasmTransaction, VoidLogger, buildDSN, connect, drizzle, getEnvironment, getJsDelivrBundles, isLiterallyTrue, mapColumnData, mapStructRowData, parseDSN, selectBundle, withSavepoint };

//# sourceMappingURL=index.mjs.map