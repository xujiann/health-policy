# -*- coding: utf-8 -*-
"""把 SQLite 语料导出成静态网站用的 JSON 数据包。

产出（site/data/ 下）：
  policies.json   政策清单（紧凑字段，供前端检索/筛选/列表）
  trends.json     预置主题逐年数量 + 各主题命中政策 id（趋势页用）
  meta.json       分面（年份/分类/机关）、统计、构建时间

前端纯静态读取这些 JSON，本地直接打开或 GitHub Pages 部署都能跑。
用法： python build_site.py
"""
import datetime as dt
import json
import os
import re
import sqlite3
import sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from keywords import THEMES  # noqa: E402

DB_PATH = os.path.join(HERE, "policies.db")
OUT = os.path.join(HERE, "site", "data")
CAT_LABEL = {
    "gongwen": "国务院公文",
    "bumenfile": "部门文件",
    "otherfile": "其他文件",
    "gongbao": "国务院公报",
}


def norm_org(org):
    """发布机关常含多个部门，取首个主办单位用于分面统计。"""
    if not org:
        return "未标注"
    first = re.split(r"[ 　,，、]+", org.strip())[0]
    return first or "未标注"


def main():
    if not os.path.exists(DB_PATH):
        sys.exit("找不到 policies.db，请先运行 harvest.py")
    os.makedirs(OUT, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """SELECT id,title,pcode,puborg,childtype,category,pubdate,pubyear,summary,url,
                  CASE WHEN fulltext IS NOT NULL AND fulltext<>'' THEN 1 ELSE 0 END AS hasft
           FROM policies WHERE pubyear IS NOT NULL ORDER BY pubdate DESC"""
    ).fetchall()

    policies = []
    org_count = {}
    year_count = {}
    cat_count = {}
    for r in rows:
        org = norm_org(r["puborg"])
        summ = (r["summary"] or "")[:140]
        policies.append(
            {
                "id": r["id"],
                "t": r["title"],
                "pc": r["pcode"] or "",
                "og": r["puborg"] or "",
                "ogk": org,
                "c": r["category"],
                "d": r["pubdate"],
                "y": r["pubyear"],
                "s": summ,
                "u": r["url"],
            }
        )
        org_count[org] = org_count.get(org, 0) + 1
        year_count[str(r["pubyear"])] = year_count.get(str(r["pubyear"]), 0) + 1
        cat_count[r["category"]] = cat_count.get(r["category"], 0) + 1

    # ---- 趋势：分级相关性 ----
    # 强相关（strong）：主题词命中标题 —— 这篇就是关于该主题的，几乎无“顺带提及”噪声。
    # 弱相关（weak）  ：主题词只命中摘要、未命中标题 —— 可能相关、也可能只是顺带提及。
    # 前端可切“仅强相关 / 标题+摘要”，对“真正相关”的趋势更可控。
    years = sorted({p["y"] for p in policies})
    trends = {"years": years, "themes": {}}
    for theme, words in THEMES.items():
        strong_year = {y: 0 for y in years}
        all_year = {y: 0 for y in years}
        n_strong = n_weak = 0
        for p in policies:
            in_title = any(w in p["t"] for w in words)
            in_summ = any(w in p["s"] for w in words)
            if in_title:
                strong_year[p["y"]] += 1
                all_year[p["y"]] += 1
                n_strong += 1
            elif in_summ:
                all_year[p["y"]] += 1
                n_weak += 1
        trends["themes"][theme] = {
            "words": words,
            "series_strong": [strong_year[y] for y in years],
            "series_all": [all_year[y] for y in years],
            "strong": n_strong,
            "weak": n_weak,
        }

    top_orgs = sorted(org_count.items(), key=lambda kv: -kv[1])[:40]
    meta = {
        "built_at": dt.datetime.now().isoformat(timespec="seconds"),
        "total": len(policies),
        "year_range": [min(years), max(years)] if years else [],
        "cat_label": CAT_LABEL,
        "cat_count": cat_count,
        "year_count": dict(sorted(year_count.items())),
        "top_orgs": top_orgs,
        "theme_names": list(THEMES.keys()),
    }

    def dump(name, obj):
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        return os.path.getsize(path)

    s1 = dump("policies.json", policies)
    s2 = dump("trends.json", trends)
    s3 = dump("meta.json", meta)
    con.close()
    print(f"导出完成：{len(policies)} 篇政策")
    print(f"  policies.json {s1/1024/1024:.2f} MB")
    print(f"  trends.json   {s2/1024:.1f} KB")
    print(f"  meta.json     {s3/1024:.1f} KB")
    print(f"  年份 {meta['year_range']}  分类 {cat_count}")


if __name__ == "__main__":
    main()
