# -*- coding: utf-8 -*-
"""用 Claude CLI（无头模式）给政策打多标签主题。

把每篇政策（标题+摘要）交给 Claude，从 keywords.py 的 TAG_THEMES 受控清单里
选 1-3 个最核心的主题（排除“顺带提及”，综合性纲领可多选），结果存入 SQLite：
  policy_themes(policy_id, theme)   每篇 0-N 行
  tag_status(policy_id, tagged_at, model)  已打标标记（断点续跑用）

只处理“尚未打标”的政策，可随时中断重跑；每日增量也复用本脚本。

用法：
  python tag_policies.py                 # 给所有未打标政策打标
  python tag_policies.py --limit 50      # 只打前 50 篇（小批验证）
  python tag_policies.py --batch 20      # 每次提交给模型的篇数（默认 20）
  python tag_policies.py --retag         # 清空旧标签后全部重打（改了主题体系时用）

依赖环境（与豆瓣项目同款，Windows）：
  - Claude CLI 装在 %APPDATA%\\npm\\claude.cmd
  - 联网走系统代理：自动从注册表读 ProxyServer 设到 HTTP(S)_PROXY
  - 中文经 Python subprocess 以 UTF-8 字节走 stdin，避开 PowerShell 编码坑
"""
import argparse
import datetime as dt
import json
import os
import re
import sqlite3
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from keywords import TAG_THEMES  # noqa: E402

DB_PATH = os.path.join(HERE, "policies.db")
MODEL_TAG = "claude-cli"
THEME_NAMES = list(TAG_THEMES.keys())
THEME_SET = set(THEME_NAMES)


def find_cli():
    cli = os.path.join(os.environ.get("APPDATA", ""), "npm", "claude.cmd")
    return cli if os.path.exists(cli) else None


def read_system_proxy():
    """从注册表读 Windows 系统代理（端口是动态的，每次现读）。"""
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                             r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        enable, _ = winreg.QueryValueEx(key, "ProxyEnable")
        if not enable:
            return None
        server, _ = winreg.QueryValueEx(key, "ProxyServer")
        winreg.CloseKey(key)
        return server.strip() if server else None
    except Exception:  # noqa: BLE001
        return None


def build_env():
    env = dict(os.environ)
    proxy = read_system_proxy()
    if proxy:
        url = proxy if proxy.startswith("http") else "http://" + proxy
        env["HTTP_PROXY"] = url
        env["HTTPS_PROXY"] = url
    return env


def init_db(con):
    con.execute("CREATE TABLE IF NOT EXISTS policy_themes (policy_id TEXT, theme TEXT, PRIMARY KEY(policy_id, theme))")
    con.execute("CREATE TABLE IF NOT EXISTS tag_status (policy_id TEXT PRIMARY KEY, tagged_at TEXT, model TEXT)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_pt_theme ON policy_themes(theme)")
    con.commit()


def theme_menu():
    return "\n".join(f"- {name}：{desc}" for name, desc in TAG_THEMES.items())


PROMPT_HEAD = (
    "你是卫生健康政策主题分类助手。请把下面每条政策归入给定主题清单中的主题。\n"
    "规则：\n"
    "1) 多标签：每条选 1-3 个最核心的主题；只在政策确实主要关于该主题时才选，"
    "排除仅“顺带提及”的；综合性、纲领性文件可多选其实际部署的子领域。\n"
    "2) 主题必须从清单里原样选取，不得自创或改写；若都不符合，themes 用空列表。\n"
    "3) 只输出一个 JSON 数组，不要任何解释、前后缀或代码块标记。\n"
    '格式示例：[{"i":1,"themes":["医改综合"]},{"i":2,"themes":["公立医院改革","医疗质量与安全"]}]\n\n'
    "【主题清单】\n"
)


def make_prompt(batch):
    lines = [PROMPT_HEAD, theme_menu(), "\n\n【待分类政策】"]
    for idx, (_pid, title, summary) in enumerate(batch, 1):
        sm = (summary or "").replace("\n", " ")[:160]
        lines.append(f"{idx}. 标题：{title}\n   摘要：{sm}")
    lines.append('\n只输出 JSON 数组。')
    return "\n".join(lines)


def call_cli(cli, env, prompt, timeout=240):
    r = subprocess.run(["cmd", "/c", cli, "-p"], input=prompt.encode("utf-8"),
                       capture_output=True, timeout=timeout, env=env)
    out = r.stdout.decode("utf-8", "replace")
    err = r.stderr.decode("utf-8", "replace")
    return r.returncode, out, err


class SessionLimit(Exception):
    """Claude CLI 报告订阅用量已达限额（需等窗口重置）。"""


def is_limit(text):
    t = (text or "").lower()
    return ("session limit" in t) or ("hit your" in t) or ("usage limit" in t)


def parse_json_array(text):
    """从模型输出里抽出第一个 JSON 数组并解析。"""
    # 去掉可能的 ```json 包裹
    text = re.sub(r"```(?:json)?", "", text)
    m = re.search(r"\[.*\]", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:  # noqa: BLE001
        return None


def tag_batch(cli, env, con, batch, log):
    prompt = make_prompt(batch)
    for attempt in range(2):
        try:
            rc, out, err = call_cli(cli, env, prompt)
        except subprocess.TimeoutExpired:
            log(f"  超时，重试 {attempt + 1}")
            continue
        if is_limit(out) or is_limit(err):
            raise SessionLimit((out or err).strip()[:80])
        data = parse_json_array(out)
        if data is None:
            log(f"  解析失败（rc={rc}），重试 {attempt + 1}；输出片段：{out[:120]!r} {err[:120]!r}")
            time.sleep(2)
            continue
        # 写库
        now = dt.datetime.now().isoformat(timespec="seconds")
        applied = 0
        by_index = {int(d.get("i", -1)): d.get("themes", []) for d in data if isinstance(d, dict)}
        for idx, (pid, _t, _s) in enumerate(batch, 1):
            themes = by_index.get(idx, [])
            for th in themes:
                if th in THEME_SET:
                    con.execute("INSERT OR IGNORE INTO policy_themes(policy_id, theme) VALUES (?,?)", (pid, th))
                    applied += 1
            con.execute("INSERT OR REPLACE INTO tag_status(policy_id, tagged_at, model) VALUES (?,?,?)",
                        (pid, now, MODEL_TAG))
        con.commit()
        return True, applied
    return False, 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 篇未打标政策（0=全部）")
    ap.add_argument("--batch", type=int, default=20, help="每次提交给模型的篇数")
    ap.add_argument("--retag", action="store_true", help="清空旧标签后全部重打")
    args = ap.parse_args()

    cli = find_cli()
    if not cli:
        sys.exit("找不到 Claude CLI（%APPDATA%\\npm\\claude.cmd）")
    env = build_env()
    if "HTTPS_PROXY" not in env:
        print("警告：未读到系统代理，CLI 可能无法联网")

    con = sqlite3.connect(DB_PATH)
    init_db(con)
    if args.retag:
        con.execute("DELETE FROM policy_themes")
        con.execute("DELETE FROM tag_status")
        con.commit()
        print("已清空旧标签，准备全量重打")

    rows = con.execute(
        """SELECT id, title, summary FROM policies
           WHERE id NOT IN (SELECT policy_id FROM tag_status)
           ORDER BY RANDOM()"""
    ).fetchall()
    if args.limit:
        rows = rows[: args.limit]
    total = len(rows)
    if total == 0:
        print("没有待打标的政策（都已打标）。")
        return
    print(f"待打标 {total} 篇，每批 {args.batch} 篇，模型走 Claude CLI …")

    done = ok_batches = fail_batches = 0
    t0 = time.time()
    for i in range(0, total, args.batch):
        batch = rows[i: i + args.batch]
        try:
            ok, applied = tag_batch(cli, env, con, batch, log=print)
        except SessionLimit as e:
            tagged_now = con.execute("SELECT COUNT(*) FROM tag_status").fetchone()[0]
            print(f"\n⚠ 已达 Claude 订阅用量限额（{e}），停止。")
            print(f"  已打标 {tagged_now} 篇，剩余约 {total - done} 篇。")
            print(f"  额度窗口重置后再次运行本脚本即可断点续跑（只补未打标的）。")
            con.close()
            return
        done += len(batch)
        if ok:
            ok_batches += 1
        else:
            fail_batches += 1
        rate = done / max(1e-9, (time.time() - t0))
        eta = (total - done) / max(1e-9, rate)
        print(f"[{done}/{total}] 批{'OK' if ok else '失败'} 本批写入{applied}标签 "
              f"速度{rate:.1f}篇/秒 ETA{eta/60:.1f}分")

    tagged = con.execute("SELECT COUNT(*) FROM tag_status").fetchone()[0]
    pairs = con.execute("SELECT COUNT(*) FROM policy_themes").fetchone()[0]
    print(f"完成：本轮 {done} 篇（失败批 {fail_batches}）；库内已打标 {tagged} 篇，"
          f"主题标签 {pairs} 条。")
    con.close()


if __name__ == "__main__":
    main()
