# -*- coding: utf-8 -*-
"""把 SQLite 语料导出成静态网站用的 JSON 数据包。

产出（site/data/ 下）：
  policies.json   政策清单（含每篇的 AI 主题标签 th，供检索/筛选/列表）
  trends.json     各 AI 主题逐年数量（趋势页预置曲线，基于 LLM 打标）
  meta.json       分面（年份/分类/机关/主题）、统计、构建时间

趋势预置主题来自 tag_policies.py 的 LLM 打标（policy_themes 表），是“语义相关”。
前端的“自定义关键词”仍是前端实时词匹配，二者互补。
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
from keywords import TAG_THEMES  # noqa: E402
from policy_pipeline import build_outputs, write_outputs  # noqa: E402

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


def load_theme_map(con):
    """policy_id -> [主题标签]；表不存在（尚未打标）时返回空。"""
    theme_map = {}
    try:
        for pid, th in con.execute("SELECT policy_id, theme FROM policy_themes"):
            theme_map.setdefault(pid, []).append(th)
    except sqlite3.OperationalError:
        pass
    return theme_map


def count_tagged(con):
    try:
        return con.execute("SELECT COUNT(*) FROM tag_status").fetchone()[0]
    except sqlite3.OperationalError:
        return 0


def main():
    if not os.path.exists(DB_PATH):
        sys.exit("找不到 policies.db，请先运行 harvest.py")
    os.makedirs(OUT, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    theme_map = load_theme_map(con)
    rows = con.execute(
        """SELECT id,title,pcode,puborg,childtype,category,pubdate,pubyear,summary,url
           FROM policies WHERE pubyear IS NOT NULL ORDER BY pubdate DESC"""
    ).fetchall()

    raw_policies = []
    for r in rows:
        org = norm_org(r["puborg"])
        summ = (r["summary"] or "")[:140]
        th = [t for t in theme_map.get(r["id"], []) if t in TAG_THEMES]
        raw_policies.append(
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
                "th": th,
            }
        )

    tagged = count_tagged(con)
    outputs = build_outputs(raw_policies, {"tagged": tagged})
    write_outputs(outputs, OUT)
    meta = outputs["meta"]
    trends = outputs["trends"]
    s1 = os.path.getsize(os.path.join(OUT, "policies.json"))
    s2 = os.path.getsize(os.path.join(OUT, "trends.json"))
    s3 = os.path.getsize(os.path.join(OUT, "meta.json"))
    con.close()
    print(f"导出完成：{meta['total']} 篇政策，已打标 {meta['tagged']} 篇")
    print(f"  policies.json {s1/1024/1024:.2f} MB")
    print(f"  trends.json   {s2/1024:.1f} KB")
    print(f"  meta.json     {s3/1024:.1f} KB")
    print(f"  年份 {meta['year_range']}  分类 {meta['cat_count']}")
    print(f"  主题命中 top5: {meta['theme_facet'][:5]}")


if __name__ == "__main__":
    main()
