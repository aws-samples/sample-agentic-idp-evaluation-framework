#!/usr/bin/env python3
"""Generate llms.txt and llms-full.txt for ONE IDP docs.

Walks content/docs/*.mdx, strips MDX-specific syntax, and emits:
  - public/llms.txt       — link index (title + description per page)
  - public/llms-full.txt  — concatenated markdown of every page

Run as a `prebuild` hook so the static export copies public/*.txt to out/.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "content" / "docs"
PUBLIC = ROOT / "public"

FRONT_MATTER = re.compile(r"^---\n(.*?)\n---\n?", re.DOTALL)
IMPORT_LINE = re.compile(r"^import\s+.*?from\s+['\"].*?['\"];?\s*$", re.MULTILINE)
EXPORT_LINE = re.compile(r"^export\s+.*?;?\s*$", re.MULTILINE)
JSX_BLOCK = re.compile(r"<([A-Z][A-Za-z0-9]*)[^>]*?/>|<([A-Z][A-Za-z0-9]*)[^>]*?>.*?</\2>", re.DOTALL)
SITE = os.environ.get("NEXT_PUBLIC_SITE_URL", "").rstrip("/")


def parse_meta(raw: str) -> tuple[dict[str, str], str]:
    m = FRONT_MATTER.match(raw)
    if not m:
        return {}, raw
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        match = re.match(r"(\w+):\s*(.+)", line)
        if match:
            key, value = match.groups()
            meta[key] = value.strip().strip("'\"")
    return meta, raw[m.end():]


def clean_mdx(body: str) -> str:
    body = IMPORT_LINE.sub("", body)
    body = EXPORT_LINE.sub("", body)
    body = JSX_BLOCK.sub("", body)
    return body.strip() + "\n"


def collect() -> list[tuple[str, dict[str, str], str]]:
    items: list[tuple[str, dict[str, str], str]] = []
    for path in sorted(CONTENT.rglob("*.mdx")):
        rel = path.relative_to(CONTENT).with_suffix("")
        slug = str(rel).replace(os.sep, "/")
        if slug == "index":
            slug = ""
        raw = path.read_text(encoding="utf-8")
        meta, body = parse_meta(raw)
        items.append((slug, meta, clean_mdx(body)))
    return items


def main() -> int:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    items = collect()

    # llms.txt — link index.
    index_lines: list[str] = ["# ONE IDP Docs", ""]
    for slug, meta, _ in items:
        title = meta.get("title", slug or "Introduction")
        desc = meta.get("description", "")
        path = f"/docs/{slug}" if slug else "/docs"
        url = f"{SITE}{path}" if SITE else path
        index_lines.append(f"- [{title}]({url}) — {desc}")
    (PUBLIC / "llms.txt").write_text("\n".join(index_lines) + "\n", encoding="utf-8")

    # llms-full.txt — concatenated markdown.
    full: list[str] = ["# ONE IDP Docs (full)", ""]
    for slug, meta, body in items:
        title = meta.get("title", slug or "Introduction")
        path = f"/docs/{slug}" if slug else "/docs"
        url = f"{SITE}{path}" if SITE else path
        full.append(f"\n---\n\n# {title}\n\n<{url}>\n\n{body}")
    (PUBLIC / "llms-full.txt").write_text("".join(full) + "\n", encoding="utf-8")

    print(f"generated {PUBLIC/'llms.txt'}")
    print(f"generated {PUBLIC/'llms-full.txt'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
