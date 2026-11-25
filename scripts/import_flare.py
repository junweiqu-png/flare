#!/usr/bin/env python3
"""Import an exported Flare JSON after inspecting its source structure."""
import argparse
import json
from pathlib import Path
from build import ROOT, validate


def first(item, *keys, default=""):
    for key in keys:
        if item.get(key) is not None and item[key] != "":
            return item[key]
    return default


def convert(source):
    if isinstance(source, dict) and not any(key in source for key in ("links", "apps", "bookmarks")) and isinstance(source.get("data"), dict):
        source = source["data"]
    if not isinstance(source, dict):
        raise ValueError("需要包含 apps/bookmarks 或 links 的 JSON 对象")
    if "links" in source:
        return validate(source)
    categories = source.get("categories", [])
    category_names = {}
    if isinstance(categories, list):
        for category in categories:
            if isinstance(category, dict):
                category_names[str(first(category, "id", "key", "name"))] = str(first(category, "name", "title", "label", default="未分类"))
    elif isinstance(categories, dict):
        for key, category in categories.items():
            category_names[str(key)] = str(first(category, "name", "title", default=key) if isinstance(category, dict) else category)

    links = []
    def collect(node, kind, inherited_category=""):
        if isinstance(node, list):
            for item in node:
                collect(item, kind, inherited_category)
        elif isinstance(node, dict):
            url = first(node, "url", "link", "URL", "Url", "href")
            if url:
                name = str(first(node, "name", "title", "Name", "Title", default=url))
                category = first(node, "category", "category_id", "categoryId", "Category", default=inherited_category)
                if isinstance(category, dict):
                    category = first(category, "name", "title", "id")
                category = category_names.get(str(category), str(category or "未分类"))
                links.append({"name": name, "url": str(url), "category": category,
                              "description": str(first(node, "description", "desc", "Description")), "kind": kind})
            elif any(key in node for key in ("items", "links", "bookmarks")):
                group = str(first(node, "name", "title", "category", default=inherited_category))
                for key in ("items", "links", "bookmarks"):
                    if key in node:
                        collect(node[key], kind, group)
            else:
                for key, value in node.items():
                    if isinstance(value, (list, dict)):
                        collect(value, kind, category_names.get(str(key), str(key)))
                    elif isinstance(value, str) and value.startswith(("http://", "https://")):
                        collect({"name": str(key), "url": value}, kind, inherited_category)

    for key in ("apps", "bookmarks"):
        if key in source:
            collect(source[key], key)
    if not links:
        raise ValueError("没有识别出导航条目；需要先检查原始 JSON 结构")
    result = {"title": str(source.get("title") or "Flare 导航"), "description": "我的常用站点",
              "recovery": {"complete": False, "message": "原始数据已导入，条目数量和分类尚待核对。"}, "links": links}
    return validate(result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "data/nav.json")
    args = parser.parse_args()
    result = convert(json.loads(args.source.read_text(encoding="utf-8-sig")))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"导入 {len(result['links'])} 个入口。请核对数量、分类和顶部应用后再标记恢复完成。")
