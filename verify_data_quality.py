# -*- coding: utf-8 -*-
"""Validate generated static policy data before publishing."""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "site", "data")


def load(name):
    with open(os.path.join(DATA, name), "r", encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    policies = load("policies.json")
    meta = load("meta.json")
    quality = load("quality_report.json")
    relationships = load("relationships.json")
    timelines = load("keyword_timelines.json")

    errors = []
    if not policies:
        errors.append("policies.json is empty")
    if meta.get("total") != len(policies):
        errors.append(f"meta.total={meta.get('total')} but policies={len(policies)}")
    if not meta.get("checked_at"):
        errors.append("meta.checked_at is missing")
    if quality.get("policy_total") != len(policies):
        errors.append("quality_report.policy_total does not match policies")
    if relationships.get("edge_total", 0) < len(relationships.get("edges", [])):
        errors.append("relationships.edge_total is smaller than exported edge count")
    if not timelines.get("topics"):
        errors.append("keyword_timelines has no topics")

    bad_titles = [p for p in policies if "客户端下载页" in (p.get("t") or "")]
    if bad_titles:
        errors.append("non-policy download page leaked into policies.json")

    doc_missing = (meta.get("quality") or {}).get("docMissing", 0)
    if len(policies) and doc_missing / len(policies) > 0.45:
        errors.append("too many policies are missing document numbers")

    result = {
        "ok": not errors,
        "total": len(policies),
        "checked_at": meta.get("checked_at"),
        "quality_status": quality.get("status"),
        "relationship_edges": relationships.get("edge_total"),
        "timeline_topics": len(timelines.get("topics") or {}),
        "errors": errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
