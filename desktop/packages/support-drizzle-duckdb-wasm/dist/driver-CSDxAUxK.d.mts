import { ConnectOptions, DuckDBWasmClient } from "@lingbo/duckdb-wasm";
import { Assume, DrizzleConfig, Logger, Query, RelationalSchemaConfig, TablesRelationalConfig, entityKind } from "drizzle-orm";
import { PgDatabase, PgDialect, PgPreparedQuery, PgQueryResultHKT, PgSession, PgTransaction, PgTransactionConfig, PreparedQueryConfig, SelectedFieldsOrdered } from "drizzle-orm/pg-core";

//#region src/session.d.ts
type Row = Record<string, any>;
type RowList<T extends Row[]> = T;
declare class DuckDBWASMPreparedQuery<T extends PreparedQueryConfig> extends PgPreparedQuery<T> {
  private client;
  private queryString;
  private params;
  private logger;
  private fields;
  private customResultMapper?;
  static readonly [entityKind]: string;
  constructor(client: Promise<DuckDBWasmClient>, queryString: string, params: unknown[], logger: Logger, fields: SelectedFieldsOrdered | undefined, customResultMapper?: ((rows: unknown[][]) => T["execute"]) | undefined);
  execute(placeholderValues?: Record<string, unknown> | undefined): Promise<T['execute']>;
  all(placeholderValues?: Record<string, unknown> | undefined): Promise<T['all']>;
}
interface DuckDBWASMSessionOptions {
  logger?: Logger;
}
declare class DuckDBWasmSession<TSQL extends Promise<DuckDBWasmClient>, TFullSchema extends Record<string, unknown>, TSchema extends TablesRelationalConfig> extends PgSession<DuckDBWasmQueryResultHKT, TFullSchema, TSchema> {
  client: TSQL;
  private schema;
  readonly options: DuckDBWASMSessionOptions;
  static readonly [entityKind]: string;
  logger: Logger;
  constructor(client: TSQL, dialect: PgDialect, schema: RelationalSchemaConfig<TSchema> | undefined, options?: DuckDBWASMSessionOptions);
  prepareQuery<T extends PreparedQueryConfig = PreparedQueryConfig>(query: Query, fields: SelectedFieldsOrdered | undefined, _name: string | undefined, _isResponseInArrayMode: boolean, customResultMapper?: (rows: unknown[][]) => T['execute']): PgPreparedQuery<T>;
  query(query: string, params: unknown[]): Promise<RowList<Row[]>>;
  queryObjects<T extends Row>(query: string, params: unknown[]): Promise<RowList<T[]>>;
  transaction<T>(transaction: (tx: DuckDBWasmTransaction<TFullSchema, TSchema>) => Promise<T>, config?: PgTransactionConfig): Promise<T>;
}
declare class DuckDBWasmTransaction<TFullSchema extends Record<string, unknown>, TSchema extends TablesRelationalConfig> extends PgTransaction<DuckDBWasmQueryResultHKT, TFullSchema, TSchema> {
  static readonly [entityKind]: string;
  dialect: PgDialect;
  session: DuckDBWasmSession<Promise<DuckDBWasmClient>, TFullSchema, TSchema>;
  constructor(dialect: PgDialect, session: DuckDBWasmSession<Promise<DuckDBWasmClient>, TFullSchema, TSchema>, schema: RelationalSchemaConfig<TSchema> | undefined, nestedIndex?: number);
  transaction<T>(transaction: (tx: DuckDBWasmTransaction<TFullSchema, TSchema>) => Promise<T>): Promise<T>;
}
interface DuckDBWasmQueryResultHKT extends PgQueryResultHKT {
  type: RowList<Assume<this['row'], Row>[]>;
}
//#endregion
//#region src/driver.d.ts
declare class DuckDBWasmDatabase<TSchema extends Record<string, unknown> = Record<string, never>> extends PgDatabase<DuckDBWasmQueryResultHKT, TSchema> {
  static readonly [entityKind]: string;
}
interface DuckDBWasmDrizzleDatabase<TSchema extends Record<string, unknown> = Record<string, never>, TClient extends Promise<DuckDBWasmClient> = Promise<DuckDBWasmClient>> extends DuckDBWasmDatabase<TSchema> {
  $client: TClient;
}
declare function drizzle<TSchema extends Record<string, unknown> = Record<string, never>, TClient extends Promise<DuckDBWasmClient> = Promise<DuckDBWasmClient>>(...params: [{
  connection: string | ConnectOptions;
}] | [{
  connection: string | ConnectOptions;
}, DrizzleConfig<TSchema>] | [{
  client: TClient;
}] | [{
  client: TClient;
}, DrizzleConfig<TSchema>] | [TClient | string] | [TClient | string, DrizzleConfig<TSchema>]): DuckDBWasmDrizzleDatabase<TSchema, TClient>;
declare namespace drizzle {
  function mock<TSchema extends Record<string, unknown> = Record<string, never>>(config?: DrizzleConfig<TSchema>): DuckDBWasmDatabase<TSchema> & {
    $client: '$client is not available on drizzle.mock()';
  };
}
//#endregion
export { DuckDBWASMSessionOptions as a, DuckDBWasmTransaction as c, DuckDBWASMPreparedQuery as i, Row as l, DuckDBWasmDrizzleDatabase as n, DuckDBWasmQueryResultHKT as o, drizzle as r, DuckDBWasmSession as s, DuckDBWasmDatabase as t, RowList as u };
//# sourceMappingURL=driver-CSDxAUxK.d.mts.map