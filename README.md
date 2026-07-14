# 卫生健康政策库

汇集 **2009 年新医改以来**的国家卫生健康政策，支持全文检索、多维筛选，以及
**关键词逐年趋势分析**（如「公共卫生」「医改」「分级诊疗」等主题的政策数量变化）。

纯静态网站 —— 本地直接用，也可一键部署到 GitHub Pages。

---

## 目录结构

```
health-policy/
├── keywords.py        # 种子关键词 SEED_KEYWORDS + AI 打标主题 TAG_THEMES
├── harvest.py         # 采集器：从中国政府网政策文件库抓取并入 SQLite
├── tag_policies.py    # 用 Claude CLI 给政策打多标签主题（断点续跑）
├── build_site.py      # 把 SQLite 导出成网站用的 JSON 数据包
├── run_update.ps1     # 一键「采集 + 建站(+推送)」（每日计划任务 HealthPolicyDaily）
├── tag_loop.ps1       # 「打标 + 建站 + 推送」（计划任务 HealthPolicyTagging，每 5.5h）
├── serve.ps1          # 本地起服务并打开浏览器
├── policies.db        # SQLite 语料库 + policy_themes 标签表（自动生成，不进 git）
└── site/              # 静态网站（部署 GitHub Pages 时发布这个目录）
    ├── index.html
    ├── app.js
    ├── style.css
    ├── vendor/chart.umd.min.js
    └── data/          # build_site.py 生成的 JSON（随站点一起提交）
        ├── policies.json
        ├── interpretations.json
        ├── excluded.json
        ├── quality_report.json
        ├── relationships.json
        ├── keyword_timelines.json
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

中国政府网**政策文件库**统一检索接口（`sousuo.www.gov.cn`）。原始采集会识别政府网返回的多类页面，
但网站展示口径只保留政策文件：

| 类别 | 说明 | 历史深度 |
|------|------|----------|
| 国务院公文 | 国发、国办发等 | 可至 2000 年前 |
| 部门文件 | 卫健委 / 医保局 / 药监局 / 疾控局等部委 | 约 2015 年起较全 |
| 国务院公报 | 公报版本 | 2000 年起 |

采集按 `keywords.py` 里的种子词做**标题检索**，并经相关性闸门过滤掉宽松匹配的
误中项（如「兽医管理体制改革」），按文档 id 去重后**增量入库**。
原文链接均指向政府网官方页面。

政策解读、答记者问、吹风会、新闻稿等不作为独立政策条目收录。数据生成阶段会把语料拆成：

- `policies.json`：只含正式政策文件，进入检索、筛选、趋势和关系分析。
- `interpretations.json`：政策解读、答记者问等，只挂接到对应政策文件卡片下方。
- `excluded.json`：新闻、列表页、客户端下载页等排除项，不进入统计。
- `quality_report.json`：每日质量审计，记录缺文号、缺机关、疑似异常链接等。
- `relationships.json`：同司局、同处室、同主题、同文号体系的政策关系边。
- `keyword_timelines.json`：医共体、区域医疗中心、护理等专题关键词的年度脉络数据。

> 卫健委官网（nhc.gov.cn）本身有 WZWS 反爬盾，直连会被 412 拦截；
> 政府网政策库已聚合了卫健委发布的文件，故以政府网为统一入口。

## 趋势分析口径（AI 主题打标）

「趋势分析」页的预置主题曲线基于 **AI 主题打标**：`tag_policies.py` 调用 Claude CLI
逐篇阅读标题+摘要，从 `keywords.py` 的 `TAG_THEMES`（20 个受控主题）里判定每条政策
**真正属于哪些主题**（多标签），结果存入 `policy_themes` 表，趋势按标签逐年计数。

相比字面词匹配，能排除「顺带提及」、归并同义说法、识别综合性文件涉及的多个子领域，
更接近「真正相关」。检索页也可按 AI 主题筛选。

> 为什么不用全文：gov.cn 大量历史/解读页正文是 JS 动态渲染，`requests` 抓不到
> （最大文本块仅约 42 字），故以「标题+摘要喂 LLM」判主题，既准又可行。

前端的「自定义关键词」仍是浏览器端实时词匹配（`THEMES` 也仅用于此），与 AI 标签互补。
政策页的「最新政策文件」会基于前端政策文件过滤口径展示，并提供同年份、同主题、
同归口部门的快捷筛选入口，便于从新增文件继续追踪相关政策脉络。
政策清单卡片还会按同处室、同司局、同部委和同主题计算「相关文件」，用于快速查看
同一政策脉络中的前后文件。

### 打标用法

```powershell
python tag_policies.py            # 给未打标政策打标（断点续跑）
python tag_policies.py --retag    # 改了 TAG_THEMES 后全量重打
```

> Claude 订阅有 5 小时滚动用量限额，一个窗口约能打 330 篇；超出会报 `session limit`，
> 脚本会优雅停止并保存进度，额度重置后再跑即自动续打。

## 扩展语料 / 自定义主题

编辑 `keywords.py`：
- `SEED_KEYWORDS` —— 决定采集覆盖范围（加词 → 重跑采集会增量补入）
- `THEMES` —— 决定趋势页默认展示的曲线

改完执行 `run_update.ps1` 即可。

可选：`run_update.ps1 -Fulltext` 会额外抓取每篇政策的正文（较慢，适合夜间），
正文入库后可支撑更细的全文分析。

## 自动更新（已配置两个计划任务）

| 任务 | 频率 | 做什么 |
|------|------|--------|
| `HealthPolicyDaily` | 每天 08:40 | `run_update.ps1 -Push`：采集新政策 → 建站 → 推送 |
| `HealthPolicyTagging` | 每 5.5 小时 | `tag_loop.ps1`：给未打标政策打标 → 建站 → 推送 |
| `Daily policy data update` | 每天 06:20（北京时间） | GitHub Actions 运行 `update_static_data.py --days 45 --pages 3`，发现新政策即更新 `site/data` 并触发 Pages 发布 |

两者配合：Daily 采集、Tagging 给新政策打标，数据变化后自动推送，GitHub Actions
重新部署，线上约 1 分钟刷新。存量首次打标受订阅限额需分多个窗口（约 1–2 天）完成，
之后 Tagging 每轮只处理当天新增的少量政策。

GitHub Actions 也支持手动触发：可临时调整扫描天数、每个关键词页数，或启用 `all_keywords`
做全种子词扫描，用于补查延迟入库、延迟索引或新扩展关键词后的历史遗漏。
即使某次扫描没有发现新增政策，也会更新 `site/data/meta.json` 中的 `checked_at`，
用于页面展示最近检查时间，便于确认自动更新链路仍在运行。

自动更新现在还会运行 `verify_data_quality.py`。如果正式政策清单为空、统计不一致、
客户端下载页混入政策清单、关系/关键词数据缺失，工作流会失败并阻止发布。
确需人工补录的重大政策写入 `manual_policies.json`，每日更新会自动合并、清洗、归口和发布。

## 部署到 GitHub Pages（已上线）

- **线上地址：https://xujiann.github.io/health-policy/**
- 仓库：`xujiann/health-policy`（Public）

部署方式用 **GitHub Actions**（`.github/workflows/deploy.yml`）：每次 push 到 `main`
会自动把 `site/` 目录发布到 Pages，无需手动操作，也不必把站点放进 `/docs`。
Pages 源已设为 **GitHub Actions**（`build_type=workflow`）。

> `policies.db`、`logs/` 已在 `.gitignore` 中忽略；`site/data/*.json`（网站数据）会一起提交。

### 上线后自动更新

每日计划任务 `HealthPolicyDaily`（08:40）跑的是 `run_update.ps1 -Push`：
采集 → 建站 → 若 `site/data` 有变化则自动 `git commit && git push` → Actions 自动重新部署。
**整条链路全自动**，本地数据更新后线上站点约 1 分钟内刷新。

手动更新并上线：

```powershell
powershell -ExecutionPolicy Bypass -File run_update.ps1 -Push
```

（不加 `-Push` 则只更新本地、不推送。）

## 常见问题

- **页面提示「数据加载失败」**：还没生成数据，先跑 `run_update.ps1`；并确认是用
  `serve.ps1`（http）而非双击文件打开。
- **采集时部分关键词报「查询失败」**：政府网偶发限速，脚本已自动重试；少量失败不影响整体，
  下次更新会补回。
- **想要更全的历史**：部门文件分类天然只回溯到约 2015 年；2009–2014 的国家级政策主要
  在「国务院公文 / 公报」两类里，已覆盖。
