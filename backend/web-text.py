"""Extract bounded public HTML text without executing scripts or loading resources."""
import json
import re
import sys
from pathlib import Path
from lxml import html


def extract(raw, content_type):
    charset = re.search(r'charset\s*=\s*["\']?([\w-]+)', content_type, re.I)
    encoding = charset[1] if charset else None
    if content_type.startswith('text/plain'):
        text = raw.decode(encoding or 'utf-8-sig', errors='strict')
        title = ''
    else:
        parser = html.HTMLParser(encoding=encoding, no_network=True, recover=True)
        tree = html.fromstring(raw, parser=parser)
        title = ' '.join(tree.xpath('//title/text()')).strip()[:240]
        for node in tree.xpath('//script|//style|//noscript|//template|//nav|//header|//footer|//aside|//form|//svg|//canvas|//*[@hidden]|//*[@aria-hidden="true"]'):
            node.drop_tree()
        candidates = tree.xpath('//article|//main|//*[@role="main"]')
        body = max(candidates, key=lambda item: len(item.text_content())) if candidates else tree
        for node in body.xpath('.//br'):
            node.tail = '\n' + (node.tail or '')
        for node in body.xpath('.//p|.//div|.//li|.//h1|.//h2|.//h3|.//h4|.//tr|.//pre|.//section'):
            node.tail = '\n' + (node.tail or '')
        text = body.text_content()
    lines = [re.sub(r'[^\S\n]+', ' ', line).strip() for line in text.splitlines()]
    text = '\n'.join(line for line in lines if line)
    if '\x00' in text or len(text) < 80:
        raise ValueError('未取得足够正文，页面可能需要登录、验证或 JavaScript；未生成报告')
    if len(text) > 30000:
        raise ValueError('单页正文超过 30000 字符；请改用较短的文章或具体章节')
    if len(text) < 800 and re.search(r'enable\s+javascript|javascript\s+(?:is\s+)?required|verify\s+(?:that\s+)?you\s+are\s+(?:a\s+)?human|请启用\s*javascript|人机验证', text, re.I):
        raise ValueError('页面仅返回脚本提示或人机验证内容，未取得正文')
    if re.search(r'captcha|just a moment|access denied|verify.*human|sign in|log in|安全验证|人机验证|登录', title, re.I):
        raise ValueError('页面疑似登录或验证入口，未继续读取')
    return {'title': title, 'text': text}


if __name__ == '__main__':
    source, output, content_type = sys.argv[1:4]
    result = extract(Path(source).read_bytes(), content_type)
    Path(output).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
