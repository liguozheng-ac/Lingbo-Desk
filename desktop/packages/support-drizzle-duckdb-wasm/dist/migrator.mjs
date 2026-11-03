import { readMigrationFiles } from "drizzle-orm/migrator";
//#region src/migrator.ts
async function migrate(db, config) {
	const migrations = readMigrationFiles(config);
	await db.dialect.migrate(migrations, db.session, config);
}
//#endregion
export { migrate };

//# sourceMappingURL=migrator.mjs.map