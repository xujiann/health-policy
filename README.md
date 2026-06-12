# 卫生健康政策库

汇集 **2009 年新医改以来**的国家卫生健康政策，支持全文检索、多维筛选，以及
**关键词逐年趋势分析**（如「公共卫生」「医改」「分级诊疗」等主题的政策数量变化）。

纯静态网站 —— 本地直接用，也可一键部署到 GitHub Pages。

---

## 目录结构

```
health-policy/
├── keywords.py        # 种子关键词 + 趋势主题（想扩库就改这里）
├── harvest.py         # 采集器：从中国政府网政策文件库抓取并入 SQLite
├── build_site.py      # 把 SQLite 导出成网站用的 JSON 数据包
├── run_update.ps1     # 一键「采集 + 建站」（可设每日计划任务）
├── serve.ps1          # 本地起服务并打开浏览器
├── policies.db        # SQLite 语料库（自动生成，不进 git）
└── site/              # 静态网站（部署 GitHub Pages 时发布这个目录）
    ├── index.html
    ├── app.js
    ├── style.css
    ├── vendor/chart.umd.min.js
    └── data/          # build_site.py 生成的 JSON（随站点一起提交）
        ├── policies.json
        ├── trends.json
        └── meta.json
```

## 快速开始（本地）

```powershell
# 1) 采集 + 建站（首次约几分钟）
powershell -ExecutionPolicy Bypass -File run_update.ps1

# 2) 本地预览
powershell -ExecutionPolicy Bypass -File serve.ps1
# 浏览器自动打开 http://localhost:8765/
```

> 必须通过本地服务（serve.ps1）访问，**不能直接双击 index.html** ——
> 浏览器禁止 `file://` 页面用 fetch 读取 JSON 数据。

## 数据来源

中国政府网**政策文件库**统一检索接口（`sousuo.www.gov.cn`），覆盖四类：

| 类别 | 说明 | 历史深度 |
|------|------|----------|
| 国务院公文 | 国发、国办发等 | 可至 2000 年前 |
| 部门文件 | 卫健委 / 医保局 / 药监局 / 疾控局等部委 | 约 2015 年起较全 |
| 其他文件 | 政策解读、规划等 | 2018 年起 |
| 国务院公报 | 公报版本 | 2000 年起 |

采集按 `keywords.py` 里的种子词做**标题检索**，并经相关性闸门过滤掉宽松匹配的
误中项（如「兽医管理体制改革」），按文档 id 去重后**增量入库**。
原文链接均指向政府网官方页面。

> 卫健委官网（nhc.gov.cn）本身有 WZWS 反爬盾，直连会被 412 拦截；
> 政府网政策库已聚合了卫健委发布的文件，故以政府网为统一入口。

## 趋势分析口径

「趋势分析」页按**标题或摘要命中主题关键词**逐年计数，反映各主题政策关注度的
**相对变化**。主题与命中词在 `keywords.py` 的 `THEMES` 里定义，可自行增删。
这是研究参考口径，并非该主题政策的绝对全集。

## 扩展语料 / 自定义主题

编辑 `keywords.py`：
- `SEED_KEYWORDS` —— 决定采集覆盖范围（加词 → 重跑采集会增量补入）
- `THEMES` —— 决定趋势页默认展示的曲线

改完执行 `run_update.ps1` 即可。

可选：`run_update.ps1 -Fulltext` 会额外抓取每篇政策的正文（较慢，适合夜间），
正文入库后可支撑更细的全文分析。

## 设为每日自动更新（可选）

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-ExecutionPolicy Bypass -File `"$PWD\run_update.ps1`""
$trigger = New-ScheduledTaskTrigger -Daily -At 8:30am
Register-ScheduledTask -TaskName "HealthPolicyDaily" -Action $action -Trigger $trigger `
  -Description "每日更新卫生健康政策库"
```

## 部署到 GitHub Pages

网站是纯静态的，发布 `site/` 目录即可：

1. 新建 GitHub 仓库，把本项目推上去（`policies.db`、`logs/` 已在 `.gitignore` 中忽略，
   但 `site/data/*.json` **会**一起提交 —— 那是网站的数据）。
2. 仓库 **Settings → Pages**：
   - Source 选 **Deploy from a branch**
   - Branch 选 `main`，目录选 **`/site`**（若选项里没有子目录，见下方备选）
3. 等几分钟，访问 `https://<用户名>.github.io/<仓库名>/` 即可。

**备选（Pages 只能选仓库根目录或 `/docs` 时）**：把 `site` 改名为 `docs`，
并相应改 `serve.ps1` / `launch.json` 里的目录；或加一个 GitHub Actions 工作流发布 `site/`。

> 每次更新数据后，重新 `git add site/data && git commit && git push`，Pages 会自动刷新。

## 常见问题

- **页面提示「数据加载失败」**：还没生成数据，先跑 `run_update.ps1`；并确认是用
  `serve.ps1`（http）而非双击文件打开。
- **采集时部分关键词报「查询失败」**：政府网偶发限速，脚本已自动重试；少量失败不影响整体，
  下次更新会补回。
- **想要更全的历史**：部门文件分类天然只回溯到约 2015 年；2009–2014 的国家级政策主要
  在「国务院公文 / 公报」两类里，已覆盖。
