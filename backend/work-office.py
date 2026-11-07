"""Bounded Office adapter. No GUI automation and no macro formats."""
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile


def package_check(source):
    with ZipFile(source) as package:
        if len(package.infolist()) > 5000 or sum(i.file_size for i in package.infolist()) > 50 * 1024 * 1024:
            raise ValueError('Office 解压后过大')
        if any('vbaProject' in i.filename for i in package.infolist()):
            raise ValueError('不处理含宏的文件')


def edit_docx(source, output, options):
    from lxml import etree
    package_check(source)
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    old, new = options['old_text'], options['new_text']
    if not old or len(old) > 10000 or len(new) > 10000:
        raise ValueError('替换文本为空或过长')
    with ZipFile(source) as original:
        root = etree.fromstring(original.read('word/document.xml'), etree.XMLParser(resolve_entities=False, no_network=True))
        paragraphs = root.xpath('//w:p', namespaces=ns)
        qualified = lambda name: '{' + ns['w'] + '}' + name
        protected = {qualified(name) for name in ('drawing', 'pict', 'object', 'txbxContent', 'fldSimple', 'sdt', 'ins', 'del', 'moveFrom', 'moveTo')}
        for element in root.iter():
            if element.tag in protected and old in ''.join(element.xpath('.//w:t/text()', namespaces=ns)):
                raise ValueError('待修改文字位于文本框、字段、修订或内容控件，暂不支持安全替换；原件未改')
        before_structure = [len(root.xpath('//w:' + tag, namespaces=ns)) for tag in ('p', 'tbl', 'tr', 'tc', 'r')]
        matches = []
        field_depth, field_text = 0, []
        for paragraph in paragraphs:
            if any(parent.tag in protected for parent in paragraph.iterancestors()):
                continue
            segments, current = [], []

            def flush():
                if current:
                    segments.append(current.copy())
                    current.clear()

            def walk(element):
                nonlocal field_depth, field_text
                if element is not paragraph and element.tag == qualified('p'):
                    flush(); return
                if element.tag in protected or element.tag in {qualified(name) for name in ('tab', 'br', 'cr')}:
                    flush(); return
                if element.tag == qualified('fldChar'):
                    flush()
                    kind = element.get(qualified('fldCharType'))
                    if kind == 'begin':
                        field_depth += 1
                    elif kind == 'end':
                        if old in ''.join(field_text):
                            raise ValueError('待修改文字位于动态字段，暂不支持安全替换；原件未改')
                        field_depth = max(0, field_depth - 1)
                        if not field_depth:
                            field_text = []
                    return
                if element.tag == qualified('t'):
                    if field_depth:
                        field_text.append(element.text or '')
                    else:
                        current.append(element)
                    return
                for child in element:
                    walk(child)

            walk(paragraph); flush()
            for nodes in segments:
                text = ''.join(node.text or '' for node in nodes)
                positions = list(re.finditer(re.escape(old), text))
                matches.extend((nodes, position.start(), position.end()) for position in positions)
        if field_depth:
            raise ValueError('文档含未闭合字段，暂不支持安全替换；原件未改')
        if not matches or (len(matches) > 1 and not options.get('replace_all')):
            raise ValueError('原文不存在或有多处匹配；请补充上下文或明确全部替换')
        for nodes, start, end in reversed(matches):
            offset = 0
            for node in nodes:
                text = node.text or ''
                stop = offset + len(text)
                if stop > start and offset < end:
                    left = max(0, start - offset)
                    right = min(len(text), end - offset)
                    node.text = text[:left] + (new if offset <= start < stop else '') + text[right:]
                    node.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
                offset = stop
        after_structure = [len(root.xpath('//w:' + tag, namespaces=ns)) for tag in ('p', 'tbl', 'tr', 'tc', 'r')]
        if before_structure != after_structure:
            raise ValueError('文档结构校验失败')
        with ZipFile(output, 'w') as result:
            for info in original.infolist():
                result.writestr(info, etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True) if info.filename == 'word/document.xml' else original.read(info.filename))
    return {'replacements': len(matches), 'structureUnchanged': True, 'scope': 'body_paragraphs_tables', 'limitation': '保留原有 ZIP 其他部件，不修改页眉页脚；涉及文本框、字段、修订和内容控件的目标会拒绝，不证明视觉排版完全一致'}


def safe_cell(value):
    if not (value is None or isinstance(value, (str, int, float, bool))):
        raise ValueError('单元格只支持文字、数字、布尔值或空值')
    if isinstance(value, str):
        if len(value) > 10000 or (value.startswith('=') and re.search(r'\[|https?:|WEBSERVICE|HYPERLINK|DDE|\|', value, re.I)):
            raise ValueError('单元格过长或包含外部链接公式')
    return value


def run(options, output):
    operation = options['operation']
    source = Path(options['source']) if options.get('source') else None
    if source:
        package_check(source)
    if operation == 'read':
        if source.suffix.lower() == '.xlsx':
            from openpyxl import load_workbook
            workbook = load_workbook(source, read_only=True, data_only=False, keep_links=False)
            if len(workbook.worksheets) > 20:
                raise ValueError('工作表过多')
            data = {'sheets': [{'name': sheet.title, 'rows': [list(row) for row in sheet.iter_rows(min_row=1, max_row=min(sheet.max_row, 300), max_col=min(sheet.max_column, 30), values_only=True)]} for sheet in workbook.worksheets]}
            workbook.close()
        elif source.suffix.lower() == '.pptx':
            from pptx import Presentation
            presentation = Presentation(source)
            if len(presentation.slides) > 100:
                raise ValueError('幻灯片过多')
            data = {'slides': [{'text': '\n'.join(shape.text for shape in slide.shapes if shape.has_text_frame)} for slide in presentation.slides]}
        else:
            raise ValueError('不支持的 Office 读取格式')
        return data
    if operation == 'edit_docx':
        return edit_docx(source, output, options)
    if operation == 'create_docx':
        from documents import export
        markdown = output.with_suffix('.md')
        markdown.write_text(options.get('content', ''), encoding='utf-8')
        try:
            export(markdown, output)
        finally:
            markdown.unlink(missing_ok=True)
        return {'created': True}
    data = options.get('data', {})
    if operation == 'create_xlsx':
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
        workbook = Workbook()
        workbook.remove(workbook.active)
        sheets = data.get('sheets', [])
        if not 1 <= len(sheets) <= 20:
            raise ValueError('须提供 1 至 20 张工作表')
        for item in sheets:
            sheet = workbook.create_sheet(item['name'])
            rows = item.get('rows', [])
            if len(rows) > 1000 or any(len(row) > 100 for row in rows):
                raise ValueError('表格超过 1000 行或 100 列')
            for row in rows:
                sheet.append([safe_cell(value) for value in row])
            sheet.freeze_panes = 'A2'
            for cell in sheet[1]:
                cell.font = Font(bold=True, color='FFFFFF')
                cell.fill = PatternFill('solid', fgColor='245AC4')
            for column in sheet.columns:
                letter = column[0].column_letter
                sheet.column_dimensions[letter].width = min(48, max(12, max(len(str(cell.value or '')) for cell in column) + 3))
        workbook.save(output)
        return {'sheets': len(sheets)}
    if operation == 'edit_xlsx':
        from openpyxl import load_workbook
        workbook = load_workbook(source, keep_links=False)
        sheet = workbook[data['sheet']]
        cells = data.get('cells', {})
        if not 1 <= len(cells) <= 100:
            raise ValueError('单次修改 1 至 100 个单元格')
        for address, value in cells.items():
            if not re.fullmatch(r'[A-Z]{1,3}[1-9][0-9]{0,5}', address):
                raise ValueError('单元格地址无效')
            sheet[address] = safe_cell(value)
        workbook.save(output)
        return {'cells': len(cells), 'warning': '复杂图表、外部链接及第三方扩展不保证保真，已备份原件'}
    if operation == 'create_pptx':
        from pptx import Presentation
        from pptx.util import Pt
        slides = data.get('slides', [])
        if not 1 <= len(slides) <= 30:
            raise ValueError('须提供 1 至 30 页幻灯片')
        presentation = Presentation()
        for item in slides:
            slide = presentation.slides.add_slide(presentation.slide_layouts[1])
            slide.shapes.title.text = str(item.get('title', ''))[:150]
            frame = slide.placeholders[1].text_frame
            frame.text = str(item.get('body', ''))[:3000]
            for paragraph in frame.paragraphs:
                for run in paragraph.runs:
                    run.font.name = 'Microsoft YaHei'
                    run.font.size = Pt(22)
        presentation.save(output)
        return {'slides': len(slides)}
    raise ValueError('未知 Office 操作')


if __name__ == '__main__':
    options = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    result = run(options, Path(sys.argv[2]))
    print(json.dumps(result, ensure_ascii=True, default=str))
