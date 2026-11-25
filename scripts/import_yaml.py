#!/usr/bin/env python3
"""Convert original Flare YAML data, excluding server credentials."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
import yaml
from build import ROOT, private_url, validate


def convert(directory):
    def load(name):
        return yaml.safe_load((directory / name).read_text(encoding="utf-8-sig")) or {}
    apps, bookmarks, config = load("apps.yml"), load("bookmarks.yml"), load("config.yml")
    categories = [{"id": str(c["id"]), "title": str(c["title"])} for c in bookmarks["categories"]]
    category_map = {c["id"]: c["title"] for c in categories}
    links = []
    for kind, items in (("apps", apps["links"]), ("bookmarks", bookmarks["links"])):
        for original in items:
            category = "常用应用" if kind == "apps" else category_map[str(original["category"])]
            item = {"name": str(original["name"]), "kind": kind, "category": category}
            if original.get("description"):
                item["description"] = str(original["description"])
            url = str(original["link"])
            if private_url(url, category):
                item.update(private=True, private_id="private-" + hashlib.sha256((kind + "|" + item["name"]).encode()).hexdigest()[:12], display_host=urlsplit(url).hostname)
            else:
                item["url"] = url
            links.append(item)
    data = {"title": str(config.get("Title", "Flare 导航")), "description": "我的应用与书签", "categories": categories,
            "settings": {"greetings": str(config.get("Greetings", "早上好;中午好;下午好;晚上好")).split(";"),
                         "showDateTime": bool(config.get("ShowDateTime", True)),
                         "openAppNewTab": bool(config.get("OpenAppNewTab", True)),
                         "openBookmarkNewTab": bool(config.get("OpenBookmarkNewTab", True)), "theme": str(config.get("Theme", "blues"))},
            "recovery": {"complete": True, "apps": len(apps["links"]), "bookmarks": len(bookmarks["links"]), "categories": len(categories),
                         "privateLinks": sum(bool(x.get("private")) for x in links)}, "links": links}
    return validate(data)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "data/nav.json")
    args = parser.parse_args()
    data = convert(args.directory)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(data["recovery"], ensure_ascii=False))
