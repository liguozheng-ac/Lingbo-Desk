"""Synthetic fixtures for exact DOCX edits; never reads user documents."""
import base64
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile

from docx import Document
from docx.oxml import OxmlElement
from docx.shared import Pt
from lxml import etree

backend = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('office_adapter', backend / 'work-office.py')
office = importlib.util.module_from_spec(spec)
spec.loader.exec_module(office)
spec = importlib.util.spec_from_file_location('document_adapter', backend / 'documents.py')
documents = importlib.util.module_from_spec(spec)
spec.loader.exec_module(documents)
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}


def long_document(file):
    document = Document()
    for index in range(1200):
        document.add_paragraph(f'段落{index:04d}：' + '合成资料，保留原有内容。' * 10)
    paragraph = document.add_paragraph()
    first = paragraph.add_run('待改'); first.bold = True; first.font.size = Pt(14)
    second = paragraph.add_run(','); second.italic = True
    document.add_table(rows=2, cols=2).cell(1, 1).text = '表格对照保持不变'
    document.sections[0].header.paragraphs[0].text = '页眉保持不变'
    document.sections[0].footer.paragraphs[0].text = '页脚保持不变'
    picture = file.with_suffix('.png')
    picture.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='))
    document.add_picture(str(picture))
    document.save(file)
    return documents.extract(file)


def structure(data):
    root = etree.fromstring(data)
    for node in root.xpath('//w:t', namespaces=ns):
        node.text = ''
        node.attrib.pop('{http://www.w3.org/XML/1998/namespace}space', None)
    return etree.tostring(root, method='c14n')


def reject_without_changes(source, output, old):
    before = source.read_bytes()
    try:
        office.edit_docx(source, output, {'old_text': old, 'new_text': '替换内容', 'replace_all': True})
    except ValueError:
        assert source.read_bytes() == before and not output.exists()
        return
    raise AssertionError('An unsupported or non-contiguous target was silently edited')


case, folder = sys.argv[1:3]
folder = Path(folder)
source, output = folder / 'synthetic.docx', folder / 'edited.docx'
if case == 'verify-edited-copy':
    output = Path(sys.argv[3])
    assert documents.extract(output) == documents.extract(source).replace('待改,', '已改，')
    with ZipFile(source) as a, ZipFile(output) as b:
        assert a.namelist() == b.namelist()
        for name in a.namelist():
            assert (structure(a.read(name)) == structure(b.read(name))) if name == 'word/document.xml' else (a.read(name) == b.read(name)), name
    result = {'passed': True, 'allOtherZipPartsUnchanged': True, 'nonTextDocumentXmlUnchanged': True}
elif case in ('long-window', 'format-edit', 'make-long'):
    text = long_document(source)
    assert len(text) > 100000
    if case == 'long-window':
        offset = text.index('待改') - 20
        result = subprocess.run([sys.executable, str(backend / 'documents.py'), 'extract-window', str(source), str(folder / 'window.json'), str(offset), '100'], capture_output=True, text=True, encoding='utf8')
        assert result.returncode == 0, result.stderr
        window = json.loads((folder / 'window.json').read_text(encoding='utf8'))
        assert window['text'] == text[offset:offset + 100] and window['totalCharacters'] == len(text)
        assert window['offset'] == offset and window['truncated']
        # The report importer must retain its original 60k guard.
        legacy = subprocess.run([sys.executable, str(backend / 'documents.py'), 'extract', str(source), str(folder / 'report.json')], capture_output=True, text=True, encoding='utf8')
        assert legacy.returncode != 0 and '60000' in legacy.stderr
    elif case == 'format-edit':
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        result = office.edit_docx(source, output, {'old_text': '待改,', 'new_text': '已改，'})
        assert result['replacements'] == 1
        assert documents.extract(output) == text.replace('待改,', '已改，')
        assert hashlib.sha256(source.read_bytes()).hexdigest() == before
        with ZipFile(source) as a, ZipFile(output) as b:
            assert a.namelist() == b.namelist()
            for name in a.namelist():
                if name == 'word/document.xml':
                    assert structure(a.read(name)) == structure(b.read(name))
                else:
                    assert a.read(name) == b.read(name), name
    result = {'passed': True, 'characters': len(text), 'offset': text.index('待改'), 'file': str(source)}
elif case == 'tab-boundary':
    document = Document(); paragraph = document.add_paragraph()
    paragraph.add_run('甲').add_tab(); paragraph.add_run('乙')
    document.save(source); reject_without_changes(source, output, '甲乙')
    result = {'passed': True, 'scope': 'tab is not an invisible text join'}
elif case == 'field-target':
    document = Document(); paragraph = document.add_paragraph()
    for kind in ('begin', 'separate'):
        marker = OxmlElement('w:fldChar'); marker.set('{' + ns['w'] + '}fldCharType', kind); paragraph.add_run()._r.append(marker)
    paragraph.add_run('待改,')
    marker = OxmlElement('w:fldChar'); marker.set('{' + ns['w'] + '}fldCharType', 'end'); paragraph.add_run()._r.append(marker)
    document.save(source); reject_without_changes(source, output, '待改,')
    result = {'passed': True, 'scope': 'computed fields are not rewritten as static text'}
elif case == 'textbox-target':
    document = Document(); paragraph = document.add_paragraph('待改,')
    run = paragraph.add_run(); pict = OxmlElement('w:pict')
    box = etree.SubElement(pict, '{urn:schemas-microsoft-com:vml}textbox')
    content = etree.SubElement(box, '{' + ns['w'] + '}txbxContent')
    p = etree.SubElement(content, '{' + ns['w'] + '}p')
    r = etree.SubElement(p, '{' + ns['w'] + '}r')
    etree.SubElement(r, '{' + ns['w'] + '}t').text = '待改,'
    run._r.append(pict); document.save(source)
    reject_without_changes(source, output, '待改,')
    result = {'passed': True, 'scope': 'nested textboxes cannot be edited twice or partially claimed'}
else:
    raise ValueError('Unknown fixture')
print(json.dumps(result, ensure_ascii=False))
