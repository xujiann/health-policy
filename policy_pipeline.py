# -*- coding: utf-8 -*-
"""Shared data pipeline for the health-policy static site.

The website is static, so the committed JSON files are the product.  This
module keeps the data-side rules in one place: manual official supplements,
policy-only filtering, interpretation attachment, quality auditing, and
relationship datasets used by the browser.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from collections import Counter, defaultdict
from typing import Any

from keywords import TAG_THEMES
from policy_enrichment import enrich_policies

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "site", "data")
MANUAL_PATH = os.path.join(HERE, "manual_policies.json")

CAT_LABEL = {
    "gongwen": "国务院公文",
    "bumenfile": "部门文件",
    "otherfile": "其他文件",
    "gongbao": "国务院公报",
}

INTERPRETATION_RE = re.compile(
    r"政策解读|《.+》解读|解读《|答记者问|吹风会|新闻发布会|图解|一图读懂|划重点|"
    r"专家解读|负责人就|有关情况|最新回应|问答|访谈|透视"
)
NON_POLICY_RE = re.compile(
    r"客户端下载页|政府信息公开指南|政府信息公开制度|机构职能|内设机构|主要职责|"
    r"政务公开|首页|列表页|新闻发布会$|吹风会$|每日问答|两会精神看落实|新华社记者|"
    r"记者问|最新回应|划重点|一图读懂|图解|发布.+要做这些事|一文了解|带你了解|读懂"
)
POLICY_SIGNAL_RE = re.compile(
    r"通知|意见|办法|规划|方案|标准|指南|目录|细则|决定|批复|公告|令|公报|"
    r"工作要点|行动计划|实施方案|暂行规定|管理规范|监测指标体系|评判标准|设置标准|"
    r"国办发|国发|国卫|医保|国中医药|国疾控|药监|财社|人社部发|民发|教体艺|"
    r"〔\d{4}〕\d+号"
)
DOCNO_RE = re.compile(
    r"(?:国办发|国办函|国发|国函|国卫[\u4e00-\u9fa5A-Za-z]{0,8}|"
    r"医保[\u4e00-\u9fa5A-Za-z]{0,6}|国中医药[\u4e00-\u9fa5A-Za-z]{0,8}|"
    r"国疾控[\u4e00-\u9fa5A-Za-z]{0,8}|国药监[\u4e00-\u9fa5A-Za-z]{0,8}|"
    r"药监[\u4e00-\u9fa5A-Za-z]{0,8}|财社|人社部发|民发|教体艺[\u4e00-\u9fa5A-Za-z]{0,6})"
    r"〔\d{4}〕\d+号"
)

KEYWORD_GROUPS = {
    "医共体": ["医共体", "医疗卫生共同体", "县域医共体", "紧密型"],
    "区域医疗中心": ["区域医疗中心", "国家医学中心", "医疗资源扩容", "优质医疗资源"],
    "护理": ["护理", "护士", "护理服务", "康复护理", "长期护理"],
    "分级诊疗": ["分级诊疗", "医联体", "医共体", "家庭医生", "基层医疗卫生"],
    "互联网医疗": ["互联网医疗", "互联网诊疗", "远程医疗", "智慧医院", "数字健康"],
    "长期护理保险": ["长期护理保险", "长护险", "长期护理"],
    "生育支持": ["生育支持", "优化生育", "托育", "婴幼儿照护", "生育保险"],
    "公共卫生": ["公共卫生", "基本公共卫生", "爱国卫生", "健康城市"],
    "疾控": ["疾控", "疾病预防控制", "传染病", "免疫规划", "疫苗"],
    "医保支付": ["医保支付", "DRG", "DIP", "支付方式", "付费"],
}


def load_json(path: str, default: Any) -> Any:
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def dump_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def text_of(policy: dict[str, Any]) -> str:
    return " ".join(
        str(policy.get(k) or "")
        for k in ("t", "pc", "pcv", "og", "ogv", "s")
    )


def doc_no_from_text(text: str) -> str:
    match = DOCNO_RE.search(text or "")
    return match.group(0) if match else ""


def normalize_title(text: str) -> str:
    text = re.sub(r"[《》〈〉“”‘’「」]", "", text or "")
    text = re.sub(r"（.*?）|\(.*?\)", "", text)
    text = re.sub(r"[^\u4e00-\u9fa5A-Za-z0-9]", "", text)
    text = re.sub(r"政策解读|解读|答记者问|有关情况|通知|意见|方案|办法", "", text)
    return text[:80]


def quoted_titles(text: str) -> list[str]:
    return [m.group(1) for m in re.finditer(r"《([^》]{4,80})》", text or "")]


def title_match_score(policy_title: str, ref_title: str) -> float:
    a = normalize_title(policy_title)
    b = normalize_title(ref_title)
    if len(a) < 10 or len(b) < 10:
        return 0.0
    if a in b:
        return len(a) / len(b)
    if b in a:
        return len(b) / len(a)
    return 0.0


def is_interpretation(policy: dict[str, Any]) -> bool:
    return bool(INTERPRETATION_RE.search(text_of(policy)))


def is_policy_document(policy: dict[str, Any]) -> bool:
    text = text_of(policy)
    if is_interpretation(policy):
        return False
    if policy.get("c") == "otherfile" and not doc_no_from_text(text):
        return False
    if NON_POLICY_RE.search(text) and not doc_no_from_text(text):
        return False
    return bool(POLICY_SIGNAL_RE.search(text))


def load_manual_policies() -> list[dict[str, Any]]:
    return load_json(MANUAL_PATH, [])


def merge_manual_policies(policies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    manual = load_manual_policies()
    if not manual:
        return policies
    manual_ids = {p.get("id") for p in manual if p.get("id")}
    manual_docnos = {p.get("pc") for p in manual if p.get("pc")}
    manual_titles = {p.get("t") for p in manual if p.get("t")}
    merged = [
        p
        for p in policies
        if p.get("id") not in manual_ids
        and p.get("pc") not in manual_docnos
        and p.get("t") not in manual_titles
    ]
    merged.extend(manual)
    return sorted(merged, key=lambda p: (p.get("d") or "", p.get("id") or ""), reverse=True)


def reference_titles(item: dict[str, Any]) -> list[str]:
    refs = quoted_titles(item.get("t", ""))
    return refs or quoted_titles(f"{item.get('t', '')} {item.get('s', '')}")


def attach_interpretations(
    policies: list[dict[str, Any]],
    interpretations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_doc_no: dict[str, dict[str, Any]] = {}
    for policy in policies:
        doc_no = doc_no_from_text(text_of(policy))
        if doc_no:
            by_doc_no[doc_no] = policy
        policy["interps"] = []

    for item in interpretations:
        item_text = text_of(item)
        target = None
        doc_no = doc_no_from_text(item_text)
        if doc_no:
            target = by_doc_no.get(doc_no)
        if target:
            refs = reference_titles(item)
            if refs and not any(title_match_score(target.get("t", ""), ref) >= 0.45 for ref in refs):
                target = None
        if not target:
            best_score = 0.0
            for ref in reference_titles(item):
                for policy in policies:
                    score = title_match_score(policy.get("t", ""), ref)
                    if score > best_score:
                        best_score = score
                        target = policy
            if best_score < 0.55:
                target = None
        if target is not None:
            interp = {
                "id": item.get("id"),
                "t": item.get("t", ""),
                "d": item.get("d", ""),
                "u": item.get("u", ""),
                "target": target.get("id"),
            }
            if not any(x.get("u") == interp["u"] for x in target["interps"]):
                target["interps"].append(interp)

    for policy in policies:
        policy["interps"].sort(key=lambda x: x.get("d") or "", reverse=True)
    return policies


def prepare_corpus(raw_policies: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    policies: list[dict[str, Any]] = []
    interpretations: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for item in raw_policies:
        if is_policy_document(item):
            policies.append(item)
        elif is_interpretation(item):
            interpretations.append(item)
        else:
            excluded.append(item)
    policies = attach_interpretations(policies, interpretations)
    return policies, interpretations, excluded


def rebuild_meta_and_trends(
    policies: list[dict[str, Any]],
    previous_meta: dict[str, Any] | None = None,
    interpretation_total: int = 0,
    excluded_total: int = 0,
    quality: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    previous_meta = previous_meta or {}
    years = sorted({int(p["y"]) for p in policies if p.get("y")})
    year_count = Counter(str(p.get("y")) for p in policies if p.get("y"))
    cat_count = Counter(p.get("c") or "unknown" for p in policies)
    org_count = Counter(p.get("ogvk") or p.get("ogk") or "未标注" for p in policies)
    route_count = Counter((p.get("txv") or {}).get("assignment") or "未归口" for p in policies)
    theme_total: Counter[str] = Counter()
    for policy in policies:
        for theme in policy.get("th") or []:
            if theme in TAG_THEMES:
                theme_total[theme] += 1

    trends = {"years": years, "themes": {}}
    for name in sorted(TAG_THEMES.keys(), key=lambda n: -theme_total.get(n, 0)):
        series = [
            sum(1 for p in policies if p.get("y") == y and name in (p.get("th") or []))
            for y in years
        ]
        trends["themes"][name] = {
            "desc": TAG_THEMES[name],
            "series": series,
            "total": sum(series),
        }

    built_at = dt.datetime.now().isoformat(timespec="seconds")
    tagged = previous_meta.get("tagged", 0)
    if tagged > len(policies):
        tagged = sum(1 for p in policies if p.get("th"))
    meta = {
        **previous_meta,
        "built_at": built_at,
        "checked_at": built_at,
        "total": len(policies),
        "policy_total": len(policies),
        "interpretation_total": interpretation_total,
        "excluded_total": excluded_total,
        "tagged": tagged,
        "year_range": [min(years), max(years)] if years else [],
        "cat_label": CAT_LABEL,
        "cat_count": dict(cat_count),
        "year_count": dict(sorted(year_count.items(), key=lambda x: int(x[0]))),
        "top_orgs": org_count.most_common(40),
        "theme_facet": theme_total.most_common(),
        "route_count": dict(route_count),
    }
    if quality:
        meta["quality"] = quality.get("quality", quality)
        meta["quality_status"] = quality.get("status")
    return meta, trends


def build_quality_report(
    policies: list[dict[str, Any]],
    interpretations: list[dict[str, Any]],
    excluded: list[dict[str, Any]],
) -> dict[str, Any]:
    total = len(policies)
    doc_official = sum(1 for p in policies if p.get("pcs") == "official_field")
    doc_extracted = sum(1 for p in policies if p.get("pcv") and p.get("pcs") != "official_field")
    doc_missing = total - doc_official - doc_extracted
    org_official = sum(1 for p in policies if p.get("ogs") == "official_field")
    org_extracted = sum(1 for p in policies if p.get("ogv") and p.get("ogs") != "official_field")
    org_missing = total - org_official - org_extracted
    strict_route = sum(1 for p in policies if (p.get("txv") or {}).get("assignment") == "文号归口")
    official_url = sum(1 for p in policies if "gov.cn" in (p.get("u") or ""))
    duplicate_doc_no = [
        {"docNo": doc, "count": n}
        for doc, n in Counter(p.get("pcv") or p.get("pc") for p in policies if p.get("pcv") or p.get("pc")).items()
        if n > 1
    ][:30]
    missing_doc_examples = [
        {"id": p.get("id"), "title": p.get("t"), "date": p.get("d"), "url": p.get("u")}
        for p in policies
        if not (p.get("pcv") or p.get("pc"))
    ][:20]
    suspicious = [
        {"id": p.get("id"), "title": p.get("t"), "date": p.get("d"), "reason": "非官方域名"}
        for p in policies
        if p.get("u") and "gov.cn" not in p.get("u", "")
    ][:20]
    quality = {
        "docOfficial": doc_official,
        "docExtracted": doc_extracted,
        "docMissing": doc_missing,
        "orgOfficial": org_official,
        "orgExtracted": org_extracted,
        "orgMissing": org_missing,
        "strictRoute": strict_route,
        "officialUrl": official_url,
    }
    warnings = []
    if total and doc_missing / total > 0.35:
        warnings.append("缺少文号比例较高")
    if total and org_missing / total > 0.25:
        warnings.append("缺少发文机关比例较高")
    if suspicious:
        warnings.append("存在非 gov.cn 官方域名链接")
    return {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "status": "warning" if warnings else "ok",
        "warnings": warnings,
        "quality": quality,
        "policy_total": total,
        "interpretation_total": len(interpretations),
        "excluded_total": len(excluded),
        "duplicate_doc_no": duplicate_doc_no,
        "missing_doc_examples": missing_doc_examples,
        "suspicious": suspicious,
    }


def relation_reasons(a: dict[str, Any], b: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    txa = a.get("txv") or {}
    txb = b.get("txv") or {}
    if txa.get("bureauId") and txa.get("bureauId") == txb.get("bureauId"):
        reasons.append("同司局")
    if txa.get("office") and txa.get("office") == txb.get("office"):
        reasons.append("同处室")
    shared = [t for t in a.get("th", []) if t in (b.get("th") or [])]
    if shared:
        reasons.append("同主题：" + "、".join(shared[:2]))
    pa = (a.get("pcv") or a.get("pc") or "").split("〔", 1)[0]
    pb = (b.get("pcv") or b.get("pc") or "").split("〔", 1)[0]
    if pa and pa == pb:
        reasons.append("同文号体系")
    return reasons


def build_relationships(policies: list[dict[str, Any]], max_edges: int = 800) -> dict[str, Any]:
    recent = sorted(policies, key=lambda p: p.get("d") or "", reverse=True)[:400]
    edges = []
    by_policy: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for i, a in enumerate(recent):
        for b in recent[i + 1:]:
            reasons = relation_reasons(a, b)
            if not reasons:
                continue
            score = len(reasons)
            if "同处室" in reasons:
                score += 2
            edge = {
                "source": a.get("id"),
                "target": b.get("id"),
                "score": score,
                "reasons": reasons,
            }
            edges.append(edge)
            by_policy[str(a.get("id"))].append(edge)
            by_policy[str(b.get("id"))].append(edge)
    edges.sort(key=lambda e: e["score"], reverse=True)
    return {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "edge_total": len(edges),
        "edges": edges[:max_edges],
        "top_by_policy": {
            pid: sorted(items, key=lambda e: e["score"], reverse=True)[:8]
            for pid, items in list(by_policy.items())[:400]
        },
    }


def keyword_hits(policy: dict[str, Any], words: list[str]) -> bool:
    hay = text_of(policy)
    return any(word in hay for word in words)


def build_keyword_timelines(policies: list[dict[str, Any]]) -> dict[str, Any]:
    years = sorted({int(p["y"]) for p in policies if p.get("y")})
    topics = {}
    for name, words in KEYWORD_GROUPS.items():
        hits = [p for p in policies if keyword_hits(p, words)]
        by_year = Counter(int(p["y"]) for p in hits if p.get("y"))
        top_themes = Counter(t for p in hits for t in (p.get("th") or [])).most_common(6)
        top_routes = Counter(
            " / ".join(
                x
                for x in [
                    (p.get("txv") or {}).get("ministryName"),
                    (p.get("txv") or {}).get("bureauName"),
                ]
                if x
            )
            for p in hits
            if (p.get("txv") or {}).get("bureauName")
        ).most_common(6)
        recent = sorted(hits, key=lambda p: p.get("d") or "", reverse=True)[:10]
        topics[name] = {
            "words": words,
            "total": len(hits),
            "years": years,
            "series": [by_year.get(y, 0) for y in years],
            "top_themes": top_themes,
            "top_routes": top_routes,
            "recent": [
                {
                    "id": p.get("id"),
                    "date": p.get("d"),
                    "title": p.get("t"),
                    "docNo": p.get("pcv") or p.get("pc"),
                    "url": p.get("u"),
                }
                for p in recent
            ],
        }
    return {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "topics": topics,
    }


def build_outputs(raw_policies: list[dict[str, Any]], previous_meta: dict[str, Any] | None = None) -> dict[str, Any]:
    enriched = enrich_policies([dict(p) for p in merge_manual_policies(raw_policies)])
    policies, interpretations, excluded = prepare_corpus(enriched)
    quality = build_quality_report(policies, interpretations, excluded)
    meta, trends = rebuild_meta_and_trends(
        policies,
        previous_meta,
        interpretation_total=len(interpretations),
        excluded_total=len(excluded),
        quality=quality,
    )
    return {
        "policies": policies,
        "interpretations": interpretations,
        "excluded": excluded,
        "meta": meta,
        "trends": trends,
        "quality": quality,
        "relationships": build_relationships(policies),
        "keyword_timelines": build_keyword_timelines(policies),
    }


def write_outputs(outputs: dict[str, Any], data_dir: str = DATA_DIR) -> None:
    names = {
        "policies": "policies.json",
        "interpretations": "interpretations.json",
        "excluded": "excluded.json",
        "meta": "meta.json",
        "trends": "trends.json",
        "quality": "quality_report.json",
        "relationships": "relationships.json",
        "keyword_timelines": "keyword_timelines.json",
    }
    for key, name in names.items():
        dump_json(os.path.join(data_dir, name), outputs[key])
