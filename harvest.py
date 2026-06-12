# -*- coding: utf-8 -*-
"""卫生健康政策采集器。

数据源：中国政府网统一检索 API（sousuo.www.gov.cn / search-gov），
查询「政策文件库」(t=zhengcelibrary)，覆盖四类：
  gongwen   国务院公文（国发/国办发等，历史可回溯到 1990 年代）
  bumenfile 部门文件（卫健委/医保局/药监局等部委，约 2015 年起较全）
  otherfile 其他文件
  gongbao   国务院公报（历史到 2000 年）

按 keywords.py 里的种子词逐个全文检索，翻页抓取，按文档 id 去重，
增量写入 SQLite policies.db。选项 --fulltext 会额外抓取详情页正文（GBK 解码）。

用法：
  python harvest.py                # 增量采集所有种子词
  python harvest.py --since 2009   # 只保留 2009 年及以后的文档
  python harvest.py --fulltext     # 同时抓正文（慢，适合首次或夜间）
  python harvest.py --kw 医改 公共卫生   # 只跑指定关键词（调试用）
"""
import argparse
import datetime as dt
import logging
import os
import re
import sqlite3
import sys
import time

import requests
from bs4 import BeautifulSoup

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from keywords import SEED_KEYWORDS  # noqa: E402

DB_PATH = os.path.join(HERE, "policies.db")
API = "https://sousuo.www.gov.cn/search-gov/data"
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
}
CATEGORIES = ["gongwen", "bumenfile", "otherfile", "gongbao"]
CAT_LABEL = {
    "gongwen": "国务院公文",
    "bumenfile": "部门文件",
    "otherfile": "其他文件",
    "gongbao": "国务院公报",
}
PAGE_SIZE = 50
MAX_PAGES = 40  # 单关键词单类别最多翻页数（防御性上限）

# 相关性闸门：搜索引擎按标题做的是宽松分词匹配，"医改"会误中"兽医管理体制改革"。
# 因此入库前再校验一道：标题/摘要含人体健康核心词，或发布机关是卫生口部门，或分类属"卫生"。
CORE_TOKENS = [
    "卫生", "卫健", "健康", "医疗", "医药", "医保", "医院", "疾病", "疾控", "防疫",
    "疫苗", "传染病", "中医", "中药", "药品", "药物", "医师", "护士", "诊疗", "门诊",
    "住院", "临床", "患者", "病人", "救治", "护理", "妇幼", "母婴", "公共卫生", "医改",
    "精神卫生", "职业病", "计划生育", "医养", "安宁疗护", "罕见病", "基本药物", "防控",
    "卫生健康", "生育", "托育", "近视", "口腔", "助产", "采供血", "献血",
]
HEALTH_ORG = re.compile(
    r"卫生健康|卫生计生|卫健|卫生部|医疗保障|医保局|药品监督|药监|疾病预防|疾控|"
    r"中医药|计划生育|爱国卫生|爱卫|红十字|食品药品"
)

log = logging.getLogger("harvest")


def is_relevant(title, summary, puborg, childtype):
    hay = (title or "") + " " + (summary or "")
    if any(tok in hay for tok in CORE_TOKENS):
        return True
    if puborg and HEALTH_ORG.search(puborg):
        return True
    if childtype and childtype.startswith("卫生"):
        return True
    return False


def setup_logging():
    os.makedirs(os.path.join(HERE, "logs"), exist_ok=True)
    fname = os.path.join(HERE, "logs", dt.date.today().isoformat() + ".log")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.FileHandler(fname, encoding="utf-8"), logging.StreamHandler(sys.stdout)],
    )


def make_session():
    s = requests.Session()
    s.trust_env = False  # 不走系统代理，直连政府网最稳
    s.headers.update(UA)
    return s


def init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS policies (
            id          TEXT PRIMARY KEY,   -- gov.cn 文档 id
            title       TEXT NOT NULL,
            pcode       TEXT,               -- 文号（如 国办发〔2024〕53号）
            puborg      TEXT,               -- 发布机关
            childtype   TEXT,               -- 分类（如 卫生、体育\\医药管理）
            category    TEXT,               -- 四大类: gongwen/bumenfile/...
            pubdate     TEXT,               -- YYYY-MM-DD
            pubyear     INTEGER,
            summary     TEXT,
            url         TEXT,
            fulltext    TEXT,               -- 详情页正文（可选）
            first_seen  TEXT,
            last_seen   TEXT
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS idx_year ON policies(pubyear)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_cat ON policies(category)")
    con.commit()
    return con


def clean(s):
    if not s:
        return ""
    return re.sub(r"<[^>]+>", "", str(s)).replace("\xa0", " ").strip()


def parse_date(item):
    # 优先用 pubtimeStr (YYYY.MM.DD)，回退到时间戳
    ds = item.get("pubtimeStr") or ""
    m = re.match(r"(\d{4})\.(\d{2})\.(\d{2})", ds)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}", int(m.group(1))
    ts = item.get("pubtime") or item.get("ptime")
    if ts:
        try:
            d = dt.datetime.fromtimestamp(int(ts) / 1000)
            return d.strftime("%Y-%m-%d"), d.year
        except Exception:
            pass
    return "", None


def api_query(session, q, page):
    params = {
        "t": "zhengcelibrary",
        "q": q,
        "timetype": "timeqb",
        "searchfield": "title",  # 标题检索（精度高、全部切题；配合 is_relevant 二次过滤）
        "sort": "pubtime",
        "sortType": 0,  # 升序，从最早开始
        "p": page,
        "n": PAGE_SIZE,
        "pcodeJiguan": "", "childtype": "", "subchildtype": "", "tsbq": "",
        "pubtimeyear": "", "puborg": "", "pcodeYear": "", "pcodeNum": "",
        "filetype": "", "inpro": "",
    }
    last_err = None
    for attempt in range(3):
        try:
            r = session.get(API, params=params, timeout=25)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    log.warning("查询失败 q=%s p=%s: %s", q, page, last_err)
    return None


def fetch_fulltext(session, url):
    """抓详情页正文。gov.cn 正文容器优先级：pages_content（政策库正文，单版本）
    > 编辑器视图 > UCAP-CONTENT（通用包裹）> article > body。用 bs4 提取更稳。"""
    try:
        r = session.get(url, timeout=25)
        r.encoding = r.apparent_encoding or "utf-8"
        soup = BeautifulSoup(r.text, "lxml")
        node = (
            soup.find("div", class_=re.compile(r"pages_content"))
            or soup.find("div", class_=re.compile(r"trs_editor_view|TRS_Editor|TRS_UEDITOR"))
            or soup.find(id="UCAP-CONTENT")
            or soup.find("div", class_=re.compile(r"\barticle\b"))
            or soup.body
            or soup
        )
        for tag in node(["script", "style"]):
            tag.decompose()
        text = re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()
        return text[:20000]
    except Exception as e:  # noqa: BLE001
        log.debug("正文抓取失败 %s: %s", url, e)
        return ""


def upsert(con, item, category, since_year, want_fulltext, session):
    doc_id = str(item.get("id") or "").strip()
    url = clean(item.get("url"))
    if not doc_id and url:
        doc_id = url  # 兜底用 url 当主键
    if not doc_id:
        return 0, 0
    pubdate, pubyear = parse_date(item)
    if since_year and pubyear and pubyear < since_year:
        return 0, 0
    title = clean(item.get("title"))
    summary = clean(item.get("summary"))
    puborg = clean(item.get("puborg"))
    childtype = clean(item.get("childtype"))
    if not is_relevant(title, summary, puborg, childtype):
        return 0, 0  # 宽松匹配的误中项（如兽医改革），丢弃
    now = dt.datetime.now().isoformat(timespec="seconds")
    row = con.execute("SELECT id, fulltext FROM policies WHERE id=?", (doc_id,)).fetchone()
    if row:
        # 已存在：更新 last_seen；正文缺失且需要则补抓
        if want_fulltext and not row[1] and url:
            ft = fetch_fulltext(session, url)
            con.execute("UPDATE policies SET last_seen=?, fulltext=? WHERE id=?", (now, ft, doc_id))
        else:
            con.execute("UPDATE policies SET last_seen=? WHERE id=?", (now, doc_id))
        return 0, 1
    ft = fetch_fulltext(session, url) if (want_fulltext and url) else ""
    con.execute(
        """INSERT INTO policies
           (id,title,pcode,puborg,childtype,category,pubdate,pubyear,summary,url,fulltext,first_seen,last_seen)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            doc_id, title, clean(item.get("pcode")),
            puborg, childtype, category,
            pubdate, pubyear, summary, url, ft, now, now,
        ),
    )
    return 1, 0


def harvest_keyword(con, session, kw, since_year, want_fulltext):
    new_total = upd_total = 0
    for page in range(1, MAX_PAGES + 1):
        j = api_query(session, kw, page)
        if not j or j.get("code") != 200:
            break
        catmap = (j.get("searchVO") or {}).get("catMap") or {}
        page_items = 0
        for cat in CATEGORIES:
            lst = (catmap.get(cat) or {}).get("listVO") or []
            page_items += len(lst)
            for it in lst:
                n, u = upsert(con, it, cat, since_year, want_fulltext, session)
                new_total += n
                upd_total += u
        con.commit()
        if page_items == 0:
            break
        time.sleep(0.6)  # 礼貌限速
    log.info("  [%s] 新增 %d，已存在 %d", kw, new_total, upd_total)
    return new_total, upd_total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", type=int, default=2009, help="只保留该年份及以后（默认2009）")
    ap.add_argument("--fulltext", action="store_true", help="抓取详情页正文（慢）")
    ap.add_argument("--kw", nargs="*", help="只采集指定关键词")
    args = ap.parse_args()

    setup_logging()
    kws = args.kw if args.kw else SEED_KEYWORDS
    log.info("=== 采集开始：%d 个关键词，since=%s，fulltext=%s ===", len(kws), args.since, args.fulltext)
    con = init_db()
    session = make_session()
    grand_new = grand_upd = 0
    for i, kw in enumerate(kws, 1):
        log.info("(%d/%d) 关键词：%s", i, len(kws), kw)
        n, u = harvest_keyword(con, session, kw, args.since, args.fulltext)
        grand_new += n
        grand_upd += u
    total = con.execute("SELECT COUNT(*) FROM policies").fetchone()[0]
    yrs = con.execute("SELECT MIN(pubyear), MAX(pubyear) FROM policies WHERE pubyear IS NOT NULL").fetchone()
    con.close()
    log.info("=== 采集完成：本轮新增 %d，库内合计 %d 篇，年份 %s–%s ===",
             grand_new, total, yrs[0], yrs[1])


if __name__ == "__main__":
    main()
