#!/usr/bin/env python3
"""Build an entirely static page without third-party packages."""
import json
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

ROOT = Path(__file__).resolve().parents[1]
SENSITIVE_KEYS = re.compile(r"^(token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|auth|password|passwd|secret|credential)$", re.I)


def validate(data):
    if not isinstance(data, dict) or not isinstance(data.get("links"), list):
        raise ValueError("导航数据必须包含 links 数组")
    if not data["links"]:
        raise ValueError("导航列表为空，停止生成")
    for number, item in enumerate(data["links"], 1):
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item["name"].strip():
            raise ValueError(f"第 {number} 个入口缺少名称")
        if not isinstance(item.get("url"), str):
            raise ValueError(f"第 {number} 个入口缺少链接")
        url = urlsplit(item["url"])
        if url.scheme not in ("https", "http") or not url.hostname or any(ord(c) < 32 for c in item["url"]):
            raise ValueError(f"第 {number} 个入口不是有效的 HTTP/HTTPS 链接")
        if url.username is not None or url.password is not None:
            raise ValueError(f"第 {number} 个入口含登录凭据，不能公开")
        fragment_query = url.fragment.partition("?")[2] if "?" in url.fragment else url.fragment
        if any(SENSITIVE_KEYS.fullmatch(key) for key, _ in parse_qsl(url.query, keep_blank_values=True) + parse_qsl(fragment_query, keep_blank_values=True)):
            raise ValueError(f"第 {number} 个入口可能含密钥，请移除后再发布")
        for key in ("description", "category", "icon"):
            if key in item and not isinstance(item[key], str):
                raise ValueError(f"第 {number} 个入口的 {key} 必须是文本")
    return data


def build():
    data = validate(json.loads((ROOT / "data/nav.json").read_text(encoding="utf-8-sig")))
    payload = json.dumps(data, ensure_ascii=False).replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    template = (ROOT / "src/index.html").read_text(encoding="utf-8")
    if template.count("__NAV_DATA__") != 1:
        raise ValueError("页面模板中的数据插槽不唯一")
    output = ROOT / "dist"
    output.mkdir(exist_ok=True)
    (output / "index.html").write_text(template.replace("__NAV_DATA__", payload), encoding="utf-8")
    (output / ".nojekyll").write_text("", encoding="utf-8")
    print(f"生成成功：{len(data['links'])} 个入口，{len({x.get('category', '未分类') for x in data['links']})} 个分类")


if __name__ == "__main__":
    build()
