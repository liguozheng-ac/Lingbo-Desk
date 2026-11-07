// Isolated actual SQLite/trace integration. No credentials, cloud or user files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { initializeData, source } from '../runtime/shared.mjs';
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-diagnostics-'));
initializeData(isolated);
const { getDB, closeDBForTest, insertActionLog, insertBrainUiEvent, insertRecallAudit, insertExtractAudit } = await import(source('src/db.js'));
const { beginTurn } = await import(source('src/runtime/turn-trace.js'));
const { paths } = await import(source('src/paths.js'));
try {
  process.env.LINGBO_DIAGNOSTICS_METADATA_ONLY = '0';
  insertActionLog({ timestamp: new Date().toISOString(), tool: 'read_file', summary: 'legacy fixture preserved' });
  const db = getDB(), tables = ['action_logs', 'brain_ui_events', 'recall_audit', 'extract_audit'];
  const counts = () => Object.fromEntries(tables.map(table => [table, db.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count]));
  const before = counts(), trace = path.join(paths.dataDir, 'turn-traces.jsonl'); fs.writeFileSync(trace, 'legacy fixture trace\n');
  process.env.LINGBO_DIAGNOSTICS_METADATA_ONLY = '1';
  const body = 'private synthetic diagnostic body';
  insertActionLog({ timestamp: new Date().toISOString(), tool: 'read_file', summary: body, resultPreview: body, args: { content: body } });
  insertBrainUiEvent({ eventType: 'response', payload: { content: body } });
  insertRecallAudit({ query_text: body }); insertExtractAudit({ turn_summary: body });
  const turn = beginTurn({ userMessage: body }); turn.recordRound({ content: body }); turn.end({ messages: [{ role: 'user', content: body }] });
  assert.deepEqual(counts(), before); assert.equal(fs.readFileSync(trace, 'utf8'), 'legacy fixture trace\n');
  console.log(JSON.stringify({ passed: true, scope: 'Actual isolated SQLite and turn-trace integration.', newDiagnosticBodiesPersisted: false, historicalRowsAndTracePreserved: true, tablesChecked: tables.length }, null, 2));
} finally {
  closeDBForTest();
  if (path.dirname(isolated) === path.resolve(os.tmpdir()) && path.basename(isolated).startsWith('lingbo-diagnostics-')) fs.rmSync(isolated, { recursive: true, force: true });
}
