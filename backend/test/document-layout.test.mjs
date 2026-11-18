import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { python } from '../python-runtime.mjs';
import { REPORT_FACT_RULES, runVerifiedWork } from '../work-finalize.mjs';

test('Word comparison tables keep explicit widths, repeated headers and verbatim provenance outside cells', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingbo-doc-layout-'));
  t.after(() => {
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('lingbo-doc-layout-')) fs.rmSync(directory, { recursive: true, force: true });
  });
  const input = path.join(directory, 'report.md'), output = path.join(directory, 'report.docx');
  fs.writeFileSync(input, '# DEMO-A-CN 与 DEMO-B-JP 报价对比\n\n| 项目 | 资料 A | 资料 B |\n| --- | --- | --- |\n| 来源文件名 | 报价A-中文.txt | 报价B-日本語.txt |\n| 资料编号（原文） | **DEMO-A-CN** | DEMO-B-JP |\n| 文件 SHA256 | `' + 'a'.repeat(64) + '` | ' + 'b'.repeat(64) + ' |\n\n## 风险\n金额必须按原币列示。\n\n| 序号 | 待确认事项 | 涉及资料 | 确认对象 |\n| --- | --- | --- | --- |\n| 1 | 税率与运费适用范围 | A、B | 财务与供应商 |');
  execFileSync(python, [fileURLToPath(new URL('../documents.py', import.meta.url)), 'export', input, output]);
  const inspect = String.raw`
import sys
from zipfile import ZipFile
from lxml import etree
from docx import Document
d=Document(sys.argv[1])
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
q=lambda name:'{'+ns['w']+'}'+name
assert d.paragraphs[0].text=='DEMO-A-CN 与 DEMO-B-JP 报价对比'
assert len(d.tables)==2
available=d.sections[0].page_width-d.sections[0].left_margin-d.sections[0].right_margin
for table in d.tables:
    assert not table.autofit
    widths=[c.width for c in table.columns]
    assert abs(sum(widths)-available)<4000
    assert all(w>500000 for w in widths)
    assert table.rows[0]._tr.xpath('./w:trPr/w:tblHeader')
    for row in table.rows:
        assert all(abs(cell.width-width)<1000 for cell,width in zip(row.cells,widths))
        assert all(p.paragraph_format.space_after.pt==3 for cell in row.cells for p in cell.paragraphs)
assert d.tables[0].columns[0].width>900000
table_text=' '.join(c.text for table in d.tables for row in table.rows for c in row.cells)
assert 'a'*64 not in table_text and 'b'*64 not in table_text
paragraph_text='\n'.join(p.text for p in d.paragraphs)
assert 'a'*64 in paragraph_text and 'b'*64 in paragraph_text
assert '**' not in table_text and 'DEMO-A-CN' in table_text
with ZipFile(sys.argv[1]) as z:
    for name in ('word/styles.xml','word/fontTable.xml'):
        root=etree.fromstring(z.read(name))
        assert not root.xpath('//*[@w:ascii="Courier" or @w:hAnsi="Courier" or @w:name="Courier"]',namespaces=ns)
print('layout-and-content-verified')
`;
  assert.match(execFileSync(python, ['-c', inspect, output], { encoding: 'utf8' }), /layout-and-content-verified/);
});

test('report number and currency constraints reach the execution model without changing tool permissions', async () => {
  let received;
  const tools = ['work_read', 'work_write', 'work_finish'];
  await runVerifiedWork(async options => {
    received = options;
    options.onToolCall('work_finish', {}, JSON.stringify({ ok: true, outcome: 'complete' }));
    return { content: 'done' };
  }, { systemPrompt: '只执行当前授权任务。', message: '比较报价并生成报告', tools, toolLoopLimits: { maxTotalCalls: 48 } });
  assert.ok(received.systemPrompt.startsWith('只执行当前授权任务。\n'));
  assert.ok(received.systemPrompt.includes(REPORT_FACT_RULES));
  assert.match(REPORT_FACT_RULES, /付款比例更高不等于跨币种付款金额更大/);
  assert.match(REPORT_FACT_RULES, /来源、日期和换算方向/);
  assert.match(REPORT_FACT_RULES, /实际读取工具复核产物/);
  assert.deepEqual(received.executionPolicy.allowedTools, tools);
});
