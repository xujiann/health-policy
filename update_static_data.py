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
from keywords import SEED_KEYWORDS
from policy_pipeline import build_outputs, write_outputs

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "site", "data")
PAGE_SIZE = 50
RECENT_KEYWORDS = [
    "卫生健康", "医疗卫生", "国家卫生健康委", "医疗保障", "国家医保局",
    "疾控", "国家疾控局", "中医药", "国家中医药局", "药品监管",
    "分级诊疗", "医共体", "基层医疗卫生", "公共卫生", "公立医院",
    "医保目录", "医保支付", "长期护理保险", "生育", "托育",
]

AGENCY_KEYWORDS = [
    "国家卫生健康委", "国家医疗保障局", "国家疾病预防控制局", "国家中医药管理局",
    "国家药监局", "国务院医改办", "全国爱卫办", "国家发展改革委 卫生健康",
    "财政部 卫生健康", "民政部 医养结合", "教育部 学校卫生",
]

DOC_PREFIX_KEYWORDS = [
    "国卫", "国卫办", "国卫医", "国卫基层", "国卫规划", "国卫财务",
    "国卫体改", "国卫科教", "国卫药政", "国卫老龄", "国卫妇幼",
    "国卫人口", "国卫职健", "国疾控", "国中医药", "医保发", "医保办发",
    "医保函", "国药监", "财社", "人社部发", "民发", "教体艺",
]

SYSTEM_KEYWORDS = [
    "健康中国", "国民健康规划", "十五五 国民健康", "医药卫生体制改革",
    "三医协同", "公立医院高质量发展", "医疗质量", "医疗安全",
    "区域医疗中心", "紧密型县域医共体", "家庭医生签约", "基本公共卫生",
    "传染病防控", "免疫规划", "职业健康", "老龄健康", "医养结合",
    "妇幼健康", "生育支持", "托育服务", "护理服务", "安宁疗护",
    "互联网医疗", "数字健康", "健康医疗大数据", "人工智能 医疗卫生",
    "医用设备", "集中采购", "药品耗材招采", "医保基金监管",
    "医疗服务价格", "DRG DIP", "长期护理保险",
]

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


def discovery_keywords(mode="balanced", all_keywords=False):
    if all_keywords or mode == "all":
        return list(dict.fromkeys([*SEED_KEYWORDS, *AGENCY_KEYWORDS, *DOC_PREFIX_KEYWORDS, *SYSTEM_KEYWORDS]))
    if mode == "broad":
        return list(dict.fromkeys([*RECENT_KEYWORDS, *AGENCY_KEYWORDS, *DOC_PREFIX_KEYWORDS, *SYSTEM_KEYWORDS]))
    return list(dict.fromkeys([*RECENT_KEYWORDS, *AGENCY_KEYWORDS, *SYSTEM_KEYWORDS[:18]]))


def fetch_recent(days, pages, all_keywords=False, mode="balanced"):
    cutoff = dt.date.today() - dt.timedelta(days=days)
    session = requests.Session()
    session.trust_env = False
    session.headers.update(UA)
    found = {}
    keywords = discovery_keywords(mode, all_keywords=all_keywords)
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=45)
    parser.add_argument("--pages", type=int, default=3)
    parser.add_argument("--mode", choices=["balanced", "broad", "all"], default="balanced",
                        help="discovery breadth; balanced is daily-safe, broad is deeper, all also scans every seed keyword")
    parser.add_argument("--all-keywords", action="store_true", help="scan every seed keyword; slower")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    policies = load_json("policies.json")
    interpretations = load_json("interpretations.json") if os.path.exists(os.path.join(DATA, "interpretations.json")) else []
    excluded = load_json("excluded.json") if os.path.exists(os.path.join(DATA, "excluded.json")) else []
    previous_meta = load_json("meta.json")
    by_id = {p["id"]: p for p in [*policies, *interpretations, *excluded]}
    recent = fetch_recent(args.days, args.pages, all_keywords=args.all_keywords, mode=args.mode)
    new_items = [p for pid, p in recent.items() if pid not in by_id]
    if new_items:
        by_id.update({p["id"]: p for p in new_items})
    raw_policies = sorted(by_id.values(), key=lambda p: p.get("d") or "", reverse=True)
    outputs = build_outputs(raw_policies, previous_meta)
    output_files = {
        "policies": "policies.json",
        "interpretations": "interpretations.json",
        "excluded": "excluded.json",
        "meta": "meta.json",
        "trends": "trends.json",
        "quality": "quality_report.json",
        "relationships": "relationships.json",
        "keyword_timelines": "keyword_timelines.json",
    }
    changed = new_items or any(
        json.dumps(load_json(name) if os.path.exists(os.path.join(DATA, name)) else None,
                   ensure_ascii=False, sort_keys=True)
        != json.dumps(outputs[key], ensure_ascii=False, sort_keys=True)
        for key, name in output_files.items()
    )
    if changed:
        if not args.dry_run:
            write_outputs(outputs, DATA)
    else:
        meta = {**previous_meta, "checked_at": dt.datetime.now().isoformat(timespec="seconds")}
        if not args.dry_run:
            dump_json("meta.json", meta)
    print(json.dumps({
        "new": len(new_items),
        "raw_total": len(by_id),
        "policy_total": outputs["meta"].get("total"),
        "interpretation_total": outputs["meta"].get("interpretation_total"),
        "excluded_total": outputs["meta"].get("excluded_total"),
        "days": args.days,
        "pages": args.pages,
        "mode": args.mode,
        "keyword_count": len(discovery_keywords(args.mode, all_keywords=args.all_keywords)),
        "all_keywords": args.all_keywords,
        "dry_run": args.dry_run,
        "checked_at": (outputs.get("meta") or meta).get("checked_at"),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
