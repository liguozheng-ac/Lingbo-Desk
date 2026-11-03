"""Bounded local document extraction and Markdown-to-Word export."""
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile


def extract(source):
    suffix = source.suffix.lower()
    if suffix in ('.txt', '.md'):
        raw = source.read_bytes()
        try:
            text = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            text = raw.decode('gb18030')
        if '\x00' in text:
            raise ValueError('不是有效文本文件')
        return text
    if suffix == '.docx':
        with ZipFile(source) as package:
            if sum(item.file_size for item in package.infolist()) > 40 * 1024 * 1024:
                raise ValueError('Word 解压后过大')
        from docx import Document
        from docx.table import Table
        from docx.text.paragraph import Paragraph
        document = Document(source)
        lines = []
        for child in document.element.body.iterchildren():
            if child.tag.endswith('}p'):
                lines.append(Paragraph(child, document).text)
            elif child.tag.endswith('}tbl'):
                lines.extend(' | '.join(cell.text for cell in row.cells) for row in Table(child, document).rows)
        return '\n'.join(lines)
    if suffix == '.pdf':
        from pypdf import PdfReader
        document = PdfReader(source)
        if document.is_encrypted or len(document.pages) > 100:
            raise ValueError('PDF 超过 100 页或需要密码')
        text = '\n'.join(page.extract_text() or '' for page in document.pages)
        if len(text.strip()) < 10:
            raise ValueError('PDF 未提取到文字，扫描件暂不支持 OCR')
        return text
    raise ValueError('仅支持 md、txt、docx 和文字型 PDF')


def export(source, output, manifest=None, audit=None):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt, RGBColor
    document = Document()
    section = document.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    section.top_margin = section.bottom_margin = Cm(2.2)
    section.left_margin = section.right_margin = Cm(2.5)
    for name, size in [('Normal', 11), ('Title', 22), ('Heading 1', 16), ('Heading 2', 13), ('Heading 3', 12)]:
        style = document.styles[name]
        style.font.name = 'Microsoft YaHei'
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor(0, 0, 0)
        style.element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
        style.paragraph_format.space_after = Pt(8)
        style.paragraph_format.line_spacing = 1.25
        for border in list(style.element.xpath('.//w:pBdr')):
            border.getparent().remove(border)
    title_added = False
    table_rows = []
    def flush_table():
        if not table_rows:
            return
        columns = max(len(row) for row in table_rows)
        table = document.add_table(rows=0, cols=columns)
        table.autofit = True
        for index, row in enumerate(table_rows):
            cells = table.add_row().cells
            for column, text in enumerate(row):
                cells[column].text = text
            for cell in cells:
                cell.vertical_alignment = 1
                properties = cell._tc.get_or_add_tcPr()
                shading = OxmlElement('w:shd')
                shading.set(qn('w:fill'), 'E8EEF5' if index == 0 else 'FFFFFF')
                properties.append(shading)
                borders = OxmlElement('w:tcBorders')
                for edge in ('top', 'left', 'bottom', 'right'):
                    border = OxmlElement('w:' + edge)
                    for key, value in [('val', 'single'), ('sz', '4'), ('color', 'D9D9D9')]:
                        border.set(qn('w:' + key), value)
                    borders.append(border)
                properties.append(borders)
                margins = OxmlElement('w:tcMar')
                for edge in ('top', 'left', 'bottom', 'right'):
                    margin = OxmlElement('w:' + edge)
                    margin.set(qn('w:w'), '100')
                    margin.set(qn('w:type'), 'dxa')
                    margins.append(margin)
                properties.append(margins)
        table_rows.clear()
        document.add_paragraph()
    for line in source.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or re.fullmatch(r'[-*_]{3,}', line):
            continue
        if line.startswith('|') and line.endswith('|'):
            parts = [part.strip() for part in line.strip('|').split('|')]
            if not all(re.fullmatch(r':?-+:?', part) for part in parts):
                table_rows.append(parts)
            continue
        flush_table()
        heading = re.match(r'^(#{1,6})\s+(.*)', line)
        if heading:
            text = re.sub(r'[*_`]', '', heading[2])
            text = re.sub(r'[^\w\s\u3000-\u9fff]', ' ', text).strip()
            if len(heading[1]) == 1 and not title_added:
                document.add_paragraph(text, 'Title')
                title_added = True
            else:
                document.add_heading(text, min(max(len(heading[1]) - 1, 1), 3))
            continue
        paragraph = document.add_paragraph()
        for index, part in enumerate(re.split(r'\*\*(.*?)\*\*', line)):
            run = paragraph.add_run(part.replace('`', ''))
            run.bold = bool(index % 2)
        paragraph.paragraph_format.widow_control = True
    flush_table()
    if audit:
        check = json.loads(Path(audit).read_text(encoding='utf-8'))
        document.add_heading('来源校验说明', 1)
        document.add_paragraph('引用检查存在待复核项，请结合原文检查下列提示。' if check['status'] != 'references_resolved' else '报告中的来源编号均可解析到资料。编号可追溯不代表结论已经核实。')
        for finding in check['findings'][:20]:
            document.add_paragraph(finding['message'])
        document.add_paragraph(check['scope'])
    if manifest:
        entries = json.loads(Path(manifest).read_text(encoding='utf-8'))['entries']
        document.add_heading('资料来源', 1)
        for entry in entries:
            if entry.get('kind') == 'web':
                lines = [f"[{entry['source']}] {entry.get('title', '')}（{entry['name']}）", '原始链接：' + entry['url']]
                if entry.get('finalUrl') != entry['url']:
                    lines.append('读取地址：' + entry.get('finalUrl', ''))
                lines.extend(['读取时间：' + entry.get('fetchedAt', '') + '（UTC）', '正文快照 SHA-256：' + entry['sha256']])
                for index, line in enumerate(lines):
                    paragraph = document.add_paragraph(line)
                    paragraph.paragraph_format.keep_with_next = index < len(lines) - 1
                    paragraph.paragraph_format.space_after = Pt(4)
                    paragraph.paragraph_format.line_spacing = 1.1
                    for run in paragraph.runs:
                        run.font.size = Pt(10)
            else:
                document.add_paragraph(f"[{entry['source']}] {entry['name']}")
    document.core_properties.author = ''
    document.core_properties.title = '资料整理报告'
    document.core_properties.comments = ''
    document.save(output)


if __name__ == '__main__':
    operation, source, output = sys.argv[1:4]
    if operation == 'extract':
        text = extract(Path(source))
        if not text.strip():
            raise ValueError('未提取到可用正文')
        if len(text) > 60000:
            raise ValueError('单份资料正文超过 60000 字符')
        Path(output).write_text(json.dumps({'text': text}, ensure_ascii=False), encoding='utf-8')
    elif operation == 'export':
        export(Path(source), Path(output), sys.argv[4] if len(sys.argv) > 4 else None, sys.argv[5] if len(sys.argv) > 5 else None)
    else:
        raise ValueError('未知文档操作')
