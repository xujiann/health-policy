# -*- coding: utf-8 -*-
"""Update committed static JSON without requiring policies.db.

GitHub Actions does not keep the local SQLite database. This script uses the
current site/data JSON as the baseline, fetches recent gov.cn policy-library
results, merges new records, and rebuilds meta/trends for the static site.
"""
import argparse
import datetime as dt
import json
import os
import time

import requests

from harvest import CATEGORIES, API, UA, clean, is_relevant, parse_date
from keywords import SEED_KEYWORDS, TAG_THEMES
from policy_enrichment import enrich_policies

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "site", "data")
PAGE_SIZE = 50
RECENT_KEYWORDS = [
    "卫生健康", "医疗卫生", "国家卫生健康委", "医疗保障", "国家医保局",
    "疾控", "国家疾控局", "中医药", "国家中医药局", "药品监管",
    "分级诊疗", "医共体", "基层医疗卫生", "公共卫生", "公立医院",
    "医保目录", "医保支付", "长期护理保险", "生育", "托育",
]

CAT_LABEL = {
    "gongwen": "国务院公文",
    "bumenfile": "部门文件",
    "otherfile": "其他文件",
    "gongbao": "国务院公报",
}

THEME_HINTS = {
    "医改综合": ["医改", "医药卫生体制改革", "三医联动", "改革重点任务"],
    "公立医院改革": ["公立医院", "绩效考核", "现代医院管理", "高质量发展"],
    "分级诊疗与基层": ["分级诊疗", "医共体", "医联体", "基层", "家庭医生", "县域"],
    "医疗保障": ["医保", "医疗保障", "DRG", "DIP", "异地就医", "医疗救助", "长期护理保险"],
    "药品供应与监管": ["药品", "基本药物", "短缺药", "集采", "带量采购", "仿制药"],
    "医疗器械": ["医疗器械", "体外诊断", "器械注册"],
    "公共卫生服务": ["基本公共卫生", "爱国卫生", "健康城市"],
    "疾控与传染病": ["疾控", "传染病", "疫情", "免疫规划", "疫苗"],
    "卫生应急": ["卫生应急", "医疗应急", "突发公共卫生", "紧急医学救援"],
    "中医药": ["中医", "中医药", "中药", "中西医结合"],
    "妇幼与生育": ["妇幼", "母婴", "生育", "托育", "出生缺陷", "儿童"],
    "老龄与医养": ["老龄", "老年", "医养结合", "安宁疗护", "长期护理"],
    "精神卫生": ["精神卫生", "心理健康"],
    "职业健康": ["职业健康", "职业病", "尘肺"],
    "医疗质量与安全": ["医疗质量", "医疗安全", "医院评审", "诊疗规范", "质控"],
    "卫生监督执法": ["卫生监督", "监督执法", "行政处罚"],
    "卫生人才与队伍": ["医师", "护士", "医学教育", "住院医师", "人才"],
    "健康促进与教育": ["健康促进", "健康教育", "健康素养", "控烟", "营养"],
    "互联网+医疗与数字健康": ["互联网医疗", "互联网诊疗", "远程医疗", "智慧医院", "数字健康", "数据"],
    "血液管理": ["血液", "献血", "采供血"],
}


def load_json(name):
    with open(os.path.join(DATA, name), "r", encoding="utf-8") as f:
        return json.load(f)


def dump_json(name, obj):
    with open(os.path.join(DATA, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def api_query(session, q, page):
    params = {
        "t": "zhengcelibrary",
        "q": q,
        "timetype": "timeqb",
        "searchfield": "title",
        "sort": "pubtime",
        "sortType": 1,
        "p": page,
        "n": PAGE_SIZE,
        "pcodeJiguan": "", "childtype": "", "subchildtype": "", "tsbq": "",
        "pubtimeyear": "", "puborg": "", "pcodeYear": "", "pcodeNum": "",
        "filetype": "", "inpro": "",
    }
    for attempt in range(3):
        try:
            r = session.get(API, params=params, timeout=25)
            r.raise_for_status()
            return r.json()
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None


def norm_org(org):
    if not org:
        return "未标注"
    first = clean(org).replace("　", " ").split()[0]
    return first.strip("，,、") or "未标注"


def guess_themes(title, summary):
    text = f"{title or ''} {summary or ''}"
    hits = [name for name, words in THEME_HINTS.items() if any(w in text for w in words)]
    return hits[:3]


def item_to_policy(item, category):
    pubdate, pubyear = parse_date(item)
    title = clean(item.get("title"))
    summary = clean(item.get("summary"))
    puborg = clean(item.get("puborg"))
    childtype = clean(item.get("childtype"))
    if not pubyear or not is_relevant(title, summary, puborg, childtype):
        return None
    doc_id = str(item.get("id") or clean(item.get("url"))).strip()
    if not doc_id:
        return None
    return {
        "id": doc_id,
        "t": title,
        "pc": clean(item.get("pcode")) or "",
        "og": puborg,
        "ogk": norm_org(puborg),
        "c": category,
        "d": pubdate,
        "y": pubyear,
        "s": summary[:140],
        "u": clean(item.get("url")),
        "th": guess_themes(title, summary),
    }


def fetch_recent(days, pages, all_keywords=False):
    cutoff = dt.date.today() - dt.timedelta(days=days)
    session = requests.Session()
    session.trust_env = False
    session.headers.update(UA)
    found = {}
    keywords = SEED_KEYWORDS if all_keywords else RECENT_KEYWORDS
    for kw in keywords:
        for page in range(1, pages + 1):
            data = api_query(session, kw, page)
            if not data or data.get("code") != 200:
                break
            catmap = (data.get("searchVO") or {}).get("catMap") or {}
            page_count = 0
            for cat in CATEGORIES:
                for item in (catmap.get(cat) or {}).get("listVO") or []:
                    page_count += 1
                    policy = item_to_policy(item, cat)
                    if not policy:
                        continue
                    try:
                        pubdate = dt.date.fromisoformat(policy["d"])
                    except ValueError:
                        continue
                    if pubdate >= cutoff:
                        found[policy["id"]] = policy
            if page_count == 0:
                break
        time.sleep(0.2)
    return found


def rebuild_meta_and_trends(policies, previous_meta):
    year_count, cat_count, org_count, theme_total = {}, {}, {}, {}
    years = sorted({p["y"] for p in policies})
    for p in policies:
        year_count[str(p["y"])] = year_count.get(str(p["y"]), 0) + 1
        cat_count[p["c"]] = cat_count.get(p["c"], 0) + 1
        org_key = p.get("ogvk") or p.get("ogk") or "未标注"
        org_count[org_key] = org_count.get(org_key, 0) + 1
        for th in p.get("th") or []:
            if th in TAG_THEMES:
                theme_total[th] = theme_total.get(th, 0) + 1
    trends = {"years": years, "themes": {}}
    for name in sorted(TAG_THEMES.keys(), key=lambda n: -theme_total.get(n, 0)):
        series = []
        for y in years:
            series.append(sum(1 for p in policies if p["y"] == y and name in (p.get("th") or [])))
        trends["themes"][name] = {
            "desc": TAG_THEMES[name],
            "series": series,
            "total": sum(series),
        }
    meta = {
        **previous_meta,
        "built_at": dt.datetime.now().isoformat(timespec="seconds"),
        "total": len(policies),
        "year_range": [min(years), max(years)] if years else [],
        "cat_label": CAT_LABEL,
        "cat_count": cat_count,
        "year_count": dict(sorted(year_count.items())),
        "top_orgs": sorted(org_count.items(), key=lambda kv: -kv[1])[:40],
        "theme_facet": sorted(theme_total.items(), key=lambda kv: -kv[1]),
    }
    return meta, trends


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=21)
    parser.add_argument("--pages", type=int, default=2)
    parser.add_argument("--all-keywords", action="store_true", help="scan every seed keyword; slower")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    policies = load_json("policies.json")
    previous_meta = load_json("meta.json")
    by_id = {p["id"]: p for p in policies}
    recent = fetch_recent(args.days, args.pages, all_keywords=args.all_keywords)
    new_items = [p for pid, p in recent.items() if pid not in by_id]
    if new_items:
        by_id.update({p["id"]: p for p in new_items})
    policies = sorted(by_id.values(), key=lambda p: p.get("d") or "", reverse=True)
    enriched = enrich_policies([dict(p) for p in policies])
    changed = json.dumps(enriched, ensure_ascii=False, sort_keys=True) != json.dumps(policies, ensure_ascii=False, sort_keys=True)
    if new_items or changed:
        policies = enriched
        meta, trends = rebuild_meta_and_trends(policies, previous_meta)
        if not args.dry_run:
            dump_json("policies.json", policies)
            dump_json("meta.json", meta)
            dump_json("trends.json", trends)
    print(json.dumps({"new": len(new_items), "total": len(by_id), "dry_run": args.dry_run}, ensure_ascii=False))


if __name__ == "__main__":
    main()
