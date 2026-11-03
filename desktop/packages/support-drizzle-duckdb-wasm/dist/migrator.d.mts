import { t as DuckDBWasmDatabase } from "./driver-CSDxAUxK.mjs";
import { MigrationConfig } from "drizzle-orm/migrator";

//#region src/migrator.d.ts
declare function migrate<TSchema extends Record<string, unknown>>(db: DuckDBWasmDatabase<TSchema>, config: MigrationConfig): Promise<void>;
//#endregion
export { migrate };
//# sourceMappingURL=migrator.d.mts.map