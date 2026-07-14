/* 卫生健康政策库 —— 纯前端逻辑：加载 JSON、检索筛选、分页、趋势图 */
"use strict";

const PAGE = 20;
const state = {
  policies: [], interpretations: [], excluded: [], trends: null, meta: null,
  qualityReport: null, relationships: null, keywordTimelines: null,
  filtered: [], page: 1, chart: null,
};

const $ = (s) => document.querySelector(s);
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function loadJSON(p) {
  const r = await fetch(p, { cache: "no-cache" });
  if (!r.ok) throw new Error(p + " HTTP " + r.status);
  return r.json();
}

async function loadOptionalJSON(p, fallback) {
  try {
    return await loadJSON(p);
  } catch (_e) {
    return fallback;
  }
}

async function boot() {
  try {
    const [pol, tr, meta, interpretations, excluded, qualityReport, relationships, keywordTimelines] = await Promise.all([
      loadJSON("data/policies.json"),
      loadJSON("data/trends.json"),
      loadJSON("data/meta.json"),
      loadOptionalJSON("data/interpretations.json", []),
      loadOptionalJSON("data/excluded.json", []),
      loadOptionalJSON("data/quality_report.json", null),
      loadOptionalJSON("data/relationships.json", null),
      loadOptionalJSON("data/keyword_timelines.json", null),
    ]);
    const prepared = preparePolicyCorpus(pol);
    state.interpretations = interpretations.length ? interpretations : prepared.interpretations;
    state.excluded = excluded.length ? excluded : prepared.excluded;
    state.qualityReport = qualityReport;
    state.relationships = relationships;
    state.keywordTimelines = keywordTimelines;
    state.policies = prepared.policies.map((p) => {
      const routed = window.POLICY_TAXONOMY?.classify(p) || p.txv || null;
      return {
        ...p,
        tx: window.POLICY_TAXONOMY?.normalizeRoute(routed) || null
      };
    });
    attachInterpretations(state.policies, state.interpretations);
    state.meta = buildRuntimeMeta(state.policies, meta);
    state.trends = buildRuntimeTrends(state.policies, tr);
    $("#loading").classList.add("hidden");
    initSummaryPanel();
    initFilters();
    initTabs();
    initBrowse();
    initTrend();
    initAbout();
    applyFilters();
  } catch (e) {
    $("#loading").textContent = "数据加载失败：" + e.message +
      "（请确认已运行 build_site.py 生成 data/ 下的 JSON，并通过本地服务访问）";
  }
}

/* ---------- Corpus policy-only cleanup ---------- */
const INTERPRETATION_RE = /(政策解读|《.+》解读|解读《|答记者问|吹风会|新闻发布会|图解|一图读懂|划重点|专家解读|负责人就|有关情况|最新回应|问答|访谈|透视)/;
const NON_POLICY_RE = /(客户端下载页|政府信息公开指南|政府信息公开制度|机构职能|内设机构|主要职责|政务公开|首页|列表页|新闻发布会$|吹风会$|每日问答|两会精神看落实|新华社记者|记者问|最新回应|划重点|一图读懂|图解|发布.+要做这些事|一文了解|带你了解|读懂)/;
const POLICY_SIGNAL_RE = /(通知|意见|办法|规划|方案|标准|指南|目录|细则|决定|批复|公告|令|公报|工作要点|行动计划|实施方案|暂行规定|管理规范|监测指标体系|评判标准|设置标准|国办发|国发|国卫|医保|国中医药|国疾控|药监|财社|人社部发|民发|教体艺|〔\d{4}〕\d+号)/;

function docNoFromText(text) {
  const match = (text || "").match(/(?:国办发|国办函|国发|国卫[\u4e00-\u9fa5A-Za-z]{0,8}|医保[\u4e00-\u9fa5A-Za-z]{0,6}|国中医药[\u4e00-\u9fa5A-Za-z]{0,8}|国疾控[\u4e00-\u9fa5A-Za-z]{0,8}|国药监[\u4e00-\u9fa5A-Za-z]{0,8}|药监[\u4e00-\u9fa5A-Za-z]{0,8}|财社|人社部发|民发|教体艺[\u4e00-\u9fa5A-Za-z]{0,6})〔\d{4}〕\d+号/);
  return match ? match[0] : "";
}

function normalizePolicyTitle(text) {
  return (text || "")
    .replace(/《|》|〈|〉|“|”|‘|’|「|」|（.*?）|\(.*?\)/g, "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "")
    .replace(/政策解读|解读|答记者问|有关情况|通知|意见|方案|办法/g, "")
    .slice(0, 80);
}

function quotedTitles(text) {
  return [...(text || "").matchAll(/《([^》]{4,80})》/g)]
    .map((m) => m[1])
    .filter(Boolean);
}

function referenceTitles(item) {
  return quotedTitles(item.t).length ? quotedTitles(item.t) : quotedTitles(`${item.t || ""} ${item.s || ""}`);
}

function titleMatchScore(policyTitle, refTitle) {
  const a = normalizePolicyTitle(policyTitle);
  const b = normalizePolicyTitle(refTitle);
  if (a.length < 10 || b.length < 10) return 0;
  if (a.includes(b)) return b.length / a.length;
  if (b.includes(a)) return a.length / b.length;
  return 0;
}

function hasQuotedTitleMatch(policy, item, minScore = 0.55) {
  const refs = referenceTitles(item);
  if (!refs.length) return true;
  return refs.some((ref) => titleMatchScore(policy.t, ref) >= minScore);
}

function isInterpretationItem(p) {
  const text = `${p.t || ""} ${p.s || ""}`;
  return INTERPRETATION_RE.test(text);
}

function isPolicyDocument(p) {
  const text = `${p.t || ""} ${p.pc || ""} ${p.s || ""}`;
  if (isInterpretationItem(p)) return false;
  if (p.c === "otherfile") return false;
  if (NON_POLICY_RE.test(text) && !docNoFromText(text)) return false;
  return POLICY_SIGNAL_RE.test(text);
}

function preparePolicyCorpus(items) {
  const policies = [];
  const interpretations = [];
  const excluded = [];
  items.forEach((p) => {
    if (isPolicyDocument(p)) {
      policies.push(p);
    } else if (isInterpretationItem(p)) {
      interpretations.push(p);
    } else {
      excluded.push(p);
    }
  });
  return { policies, interpretations, excluded };
}

function attachInterpretations(policies, interpretations) {
  const byDocNo = new Map();
  const byId = new Map();
  const byNormTitle = new Map();
  policies.forEach((p) => {
    byId.set(p.id, p);
    const docNo = docNoFromText(`${p.pc || ""} ${p.t || ""} ${p.s || ""}`);
    if (docNo) byDocNo.set(docNo, p);
    const norm = normalizePolicyTitle(p.t);
    if (norm) byNormTitle.set(norm, p);
    p.interps = [];
  });
  interpretations.forEach((item) => {
    const text = `${item.t || ""} ${item.s || ""}`;
    const docNo = docNoFromText(text);
    let target = item.target ? byId.get(item.target) : null;
    if (!target) target = docNo ? byDocNo.get(docNo) : null;
    if (target && !hasQuotedTitleMatch(target, item, 0.45)) target = null;
    if (!target) {
      let best = { policy: null, score: 0 };
      referenceTitles(item).forEach((ref) => {
        policies.forEach((p) => {
          const score = titleMatchScore(p.t, ref);
          if (score > best.score) best = { policy: p, score };
        });
      });
      target = best.score >= 0.55 ? best.policy : null;
    }
    if (target && !target.interps.some((x) => x.u === item.u)) {
      target.interps.push(item);
    }
  });
  policies.forEach((p) => p.interps.sort((a, b) => b.d.localeCompare(a.d)));
}

function buildRuntimeMeta(policies, sourceMeta) {
  const yearCount = {}, catCount = {}, orgCount = {}, themeCount = {}, routeCount = {};
  const quality = { docOfficial: 0, docExtracted: 0, docMissing: 0, orgOfficial: 0, orgExtracted: 0, orgMissing: 0 };
  policies.forEach((p) => {
    yearCount[p.y] = (yearCount[p.y] || 0) + 1;
    catCount[p.c] = (catCount[p.c] || 0) + 1;
    const orgKey = p.ogvk || p.ogk;
    orgCount[orgKey] = (orgCount[orgKey] || 0) + 1;
    const route = p.tx?.assignment || "未归口";
    routeCount[route] = (routeCount[route] || 0) + 1;
    if (p.pcs === "official_field") quality.docOfficial += 1;
    else if (p.pcv) quality.docExtracted += 1;
    else quality.docMissing += 1;
    if (p.ogs === "official_field") quality.orgOfficial += 1;
    else if (p.ogv) quality.orgExtracted += 1;
    else quality.orgMissing += 1;
    (p.th || []).forEach((th) => { themeCount[th] = (themeCount[th] || 0) + 1; });
  });
  const years = Object.keys(yearCount).map(Number).sort((a, b) => a - b);
  return {
    ...sourceMeta,
    total: policies.length,
    policy_total: policies.length,
    interpretation_total: policies.reduce((sum, p) => sum + (p.interps?.length || 0), 0),
    excluded_total: state.excluded.length,
    year_range: years.length ? [years[0], years[years.length - 1]] : [],
    cat_count: catCount,
    year_count: Object.fromEntries(Object.entries(yearCount).sort((a, b) => Number(a[0]) - Number(b[0]))),
    top_orgs: Object.entries(orgCount).sort((a, b) => b[1] - a[1]).slice(0, 40),
    theme_facet: Object.entries(themeCount).sort((a, b) => b[1] - a[1]),
    route_count: routeCount,
    quality,
  };
}

function buildRuntimeTrends(policies, sourceTrends) {
  const years = Object.keys(state.meta.year_count).map(Number);
  const themes = {};
  Object.keys(sourceTrends.themes).forEach((name) => {
    const byYear = Object.fromEntries(years.map((y) => [y, 0]));
    policies.forEach((p) => {
      if ((p.th || []).includes(name)) byYear[p.y] = (byYear[p.y] || 0) + 1;
    });
    const series = years.map((y) => byYear[y] || 0);
    themes[name] = {
      desc: sourceTrends.themes[name].desc,
      series,
      total: series.reduce((sum, n) => sum + n, 0),
    };
  });
  const ordered = Object.entries(themes).sort((a, b) => b[1].total - a[1].total);
  return { years, themes: Object.fromEntries(ordered) };
}

/* ---------- Tabs ---------- */
function initTabs() {
  document.querySelectorAll(".tab[data-view]").forEach((b) => {
    b.addEventListener("click", () => {
      showView(b.dataset.view);
    });
  });
  if (location.hash === "#trend") showView("trend");
}

function showView(v) {
  document.querySelectorAll(".tab[data-view]").forEach((x) =>
    x.classList.toggle("active", x.dataset.view === v));
  ["browse", "trend"].forEach((name) =>
    $("#view-" + name).classList.toggle("hidden", name !== v));
  if (v === "trend" && !state.chart) drawChart();
}

/* ---------- Filters ---------- */
function initFilters() {
  const m = state.meta;
  const yearSel = $("#f-year");
  Object.keys(m.year_count).sort().reverse().forEach((y) => {
    yearSel.insertAdjacentHTML("beforeend", `<option value="${y}">${y}（${m.year_count[y]}）</option>`);
  });
  const thSel = $("#f-theme");
  (m.theme_facet || []).forEach(([name, n]) => {
    if (n > 0) thSel.insertAdjacentHTML("beforeend", `<option value="${esc(name)}">${esc(name)}（${n}）</option>`);
  });
  const routeSel = $("#f-route");
  Object.entries(m.route_count || {}).sort((a, b) => b[1] - a[1]).forEach(([name, n]) => {
    routeSel.insertAdjacentHTML("beforeend", `<option value="${esc(name)}">${esc(name)}（${n}）</option>`);
  });
  $("#f-doc-state").insertAdjacentHTML("beforeend", [
    `<option value="doc_official">官方文号（${m.quality.docOfficial}）</option>`,
    `<option value="doc_extracted">抽取文号（${m.quality.docExtracted}）</option>`,
    `<option value="doc_missing">缺少文号（${m.quality.docMissing}）</option>`,
    `<option value="org_official">官方机关（${m.quality.orgOfficial}）</option>`,
    `<option value="org_extracted">抽取机关（${m.quality.orgExtracted}）</option>`,
    `<option value="org_missing">缺少机关（${m.quality.orgMissing}）</option>`,
  ].join(""));
  renderMinistryOptions();
  renderBureauOptions();
  renderOfficeOptions();
}

function initBrowse() {
  let timer;
  $("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(applyFilters, 200); });
  ["#f-year", "#f-theme", "#f-office", "#f-route", "#f-doc-state", "#f-sort"].forEach((s) =>
    $(s).addEventListener("change", applyFilters));
  $("#f-route-mode").addEventListener("change", () => {
    $("#f-bureau").value = "";
    $("#f-office").value = "";
    renderMinistryOptions();
    renderBureauOptions();
    renderOfficeOptions();
    applyFilters();
  });
  $("#latest-panel")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-quick]");
    if (!button) return;
    applyQuickFilter(button.dataset);
  });
  $("#active-filters")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-clear]");
    if (!button) return;
    clearBrowseFilter(button.dataset.clear);
  });
  $("#list")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-quick]");
    if (!button) return;
    applyQuickFilter(button.dataset);
  });
  $("#f-ministry").addEventListener("change", () => {
    $("#f-bureau").value = "";
    $("#f-office").value = "";
    renderBureauOptions();
    renderOfficeOptions();
    applyFilters();
  });
  $("#f-bureau").addEventListener("change", () => {
    $("#f-office").value = "";
    renderOfficeOptions();
    applyFilters();
  });
}

function resetBrowseControls() {
  ["#q", "#f-year", "#f-theme", "#f-ministry", "#f-bureau", "#f-office", "#f-route", "#f-doc-state"].forEach((selector) => {
    $(selector).value = "";
  });
  $("#f-route-mode").value = "doc_strict";
  $("#f-sort").value = "date_desc";
}

function applyQuickFilter(data) {
  resetBrowseControls();
  if (data.year) $("#f-year").value = data.year;
  if (data.theme) $("#f-theme").value = data.theme;
  if (data.ministry) $("#f-ministry").value = data.ministry;
  renderBureauOptions();
  if (data.bureau) $("#f-bureau").value = data.bureau;
  renderOfficeOptions();
  if (data.office) $("#f-office").value = data.office;
  applyFilters();
  $("#filter-details").open = Boolean(data.ministry || data.bureau || data.office);
  document.querySelector("#view-browse")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectedText(selector) {
  const sel = $(selector);
  if (!sel || !sel.value) return "";
  const text = sel.options[sel.selectedIndex]?.textContent || "";
  return text.replace(/（\d+）$/, "");
}

function activeFilterItems(q) {
  const items = [];
  if (q) items.push(["q", "关键词", q]);
  [
    ["year", "年份", "#f-year"],
    ["theme", "主题", "#f-theme"],
    ["ministry", "部委", "#f-ministry"],
    ["bureau", "司局", "#f-bureau"],
    ["office", "处室", "#f-office"],
    ["route", "归口依据", "#f-route"],
    ["doc-state", "文号/机关", "#f-doc-state"],
  ].forEach(([key, label, selector]) => {
    const value = selectedText(selector);
    if (value) items.push([key, label, value]);
  });
  if (routeMode() === "all_routes") items.push(["route-mode", "口径", selectedText("#f-route-mode")]);
  return items;
}

function updateDepartmentHint(total = state.filtered.length) {
  const box = $("#dept-filter-hint");
  if (!box) return;
  const mode = $("#f-route-mode")?.value || "doc_strict";
  const parts = [
    selectedText("#f-ministry"),
    selectedText("#f-bureau"),
    selectedText("#f-office"),
  ].filter(Boolean);
  const label = parts.length ? parts.join(" / ") : "全部部门归口";
  const basis = mode === "doc_strict" ? "按发文字号前缀严格对应" : "含发文机关识别补充";
  box.innerHTML = `<span>${esc(label)}</span><strong>${esc(String(total))}</strong> 篇政策文件 <em>${esc(basis)}</em>`;
}

function clearBrowseFilter(key) {
  if (key === "all") {
    ["#q", "#f-year", "#f-theme", "#f-ministry", "#f-bureau", "#f-office", "#f-route", "#f-doc-state"].forEach((selector) => {
      $(selector).value = "";
    });
    $("#f-route-mode").value = "doc_strict";
    $("#f-sort").value = "date_desc";
  } else if (key === "q") {
    $("#q").value = "";
  } else if (key === "year") {
    $("#f-year").value = "";
  } else if (key === "theme") {
    $("#f-theme").value = "";
  } else if (key === "route-mode") {
    $("#f-route-mode").value = "doc_strict";
    $("#f-ministry").value = "";
    $("#f-bureau").value = "";
    $("#f-office").value = "";
  } else if (key === "ministry") {
    $("#f-ministry").value = "";
    $("#f-bureau").value = "";
    $("#f-office").value = "";
  } else if (key === "bureau") {
    $("#f-bureau").value = "";
    $("#f-office").value = "";
  } else if (key === "office") {
    $("#f-office").value = "";
  } else if (key === "route") {
    $("#f-route").value = "";
  } else if (key === "doc-state") {
    $("#f-doc-state").value = "";
  }
  renderMinistryOptions();
  renderBureauOptions();
  renderOfficeOptions();
  applyFilters();
}

function countBy(items, keyFn) {
  const counts = new Map();
  items.forEach((item) => {
    const keys = keyFn(item);
    (Array.isArray(keys) ? keys : [keys]).filter(Boolean).forEach((key) =>
      counts.set(key, (counts.get(key) || 0) + 1));
  });
  return counts;
}

function routeMode() {
  return $("#f-route-mode")?.value || "doc_strict";
}

function matchesRouteMode(p, mode = routeMode()) {
  if (mode === "doc_strict") return p.tx?.assignment === "文号归口";
  return true;
}

function departmentCorpus() {
  const mode = routeMode();
  return state.policies.filter((p) => matchesRouteMode(p, mode));
}

function renderMinistryOptions() {
  const tx = window.POLICY_TAXONOMY;
  const sel = $("#f-ministry");
  const current = sel.value;
  const counts = countBy(departmentCorpus(), (p) => p.tx?.ministryIds || []);
  sel.innerHTML = `<option value="">全部部委</option>` + tx.ministries
    .filter((item) => counts.get(item.id))
    .map((item) => `<option value="${esc(item.id)}">${esc(item.name)}（${counts.get(item.id)}）</option>`)
    .join("");
  sel.value = [...sel.options].some((option) => option.value === current) ? current : "";
  updateDepartmentHint();
}

function renderBureauOptions() {
  const tx = window.POLICY_TAXONOMY;
  const ministryId = $("#f-ministry").value;
  const sel = $("#f-bureau");
  const current = sel.value;
  const pool = departmentCorpus().filter((p) => !ministryId || (p.tx?.ministryIds || []).includes(ministryId));
  const counts = countBy(pool, (p) => p.tx?.bureauId);
  const candidates = tx.bureausFor(ministryId).filter((item) => counts.get(item.id));
  sel.innerHTML = `<option value="">全部司局</option>` + candidates
    .map((item) => `<option value="${esc(item.id)}">${esc(item.name)}（${counts.get(item.id)}）</option>`)
    .join("");
  sel.value = [...sel.options].some((option) => option.value === current) ? current : "";
  updateDepartmentHint();
}

function renderOfficeOptions() {
  const tx = window.POLICY_TAXONOMY;
  const ministryId = $("#f-ministry").value;
  const bureauId = $("#f-bureau").value;
  const sel = $("#f-office");
  const current = sel.value;
  const pool = departmentCorpus().filter((p) => {
    if (ministryId && !(p.tx?.ministryIds || []).includes(ministryId)) return false;
    if (bureauId && p.tx?.bureauId !== bureauId) return false;
    return true;
  });
  const counts = countBy(pool, (p) => p.tx?.office);
  const officeNames = bureauId
    ? tx.officesFor(bureauId).filter((name) => counts.get(name))
    : [...counts.keys()].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  sel.innerHTML = `<option value="">全部处室</option>` + officeNames
    .map((name) => `<option value="${esc(name)}">${esc(name)}（${counts.get(name)}）</option>`)
    .join("");
  sel.value = [...sel.options].some((option) => option.value === current) ? current : "";
  updateDepartmentHint();
}

function applyFilters() {
  const q = $("#q").value.trim().toLowerCase();
  const y = $("#f-year").value;
  const th = $("#f-theme").value;
  const ministry = $("#f-ministry").value, bureau = $("#f-bureau").value, office = $("#f-office").value;
  const route = $("#f-route").value, docState = $("#f-doc-state").value;
  const mode = routeMode();
  const sort = $("#f-sort").value;
  let arr = state.policies.filter((p) => {
    if (!matchesRouteMode(p, mode)) return false;
    if (y && String(p.y) !== y) return false;
    if (th && !(p.th || []).includes(th)) return false;
    if (ministry && !(p.tx?.ministryIds || []).includes(ministry)) return false;
    if (bureau && p.tx?.bureauId !== bureau) return false;
    if (office && p.tx?.office !== office) return false;
    if (route && p.tx?.assignment !== route) return false;
    if (docState && !matchesDocState(p, docState)) return false;
    if (q) {
      const hay = (p.t + " " + p.pc + " " + (p.pcv || "") + " " +
        p.s + " " + p.og + " " + (p.ogv || "") + " " + taxonomyText(p)).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  arr.sort((a, b) => sort === "date_asc" ? a.d.localeCompare(b.d) : b.d.localeCompare(a.d));
  state.filtered = arr;
  state.page = 1;
  renderList();
}

function latestPolicyDate() {
  return state.policies
    .map((p) => p.d)
    .filter(Boolean)
    .sort()
    .pop() || "-";
}

function shortDateTime(value) {
  if (!value) return "-";
  return String(value).replace("T", " ").slice(0, 16);
}

function lastCheckedAt(meta = state.meta) {
  return shortDateTime(meta?.checked_at || meta?.built_at);
}

function initSummaryPanel() {
  const m = state.meta;
  $("#summary-panel").classList.remove("hidden");
  $("#stat-policy-total").textContent = m.policy_total || m.total;
  $("#stat-interpretation-total").textContent = m.interpretation_total || 0;
  $("#stat-latest-date").textContent = latestPolicyDate();
  $("#stat-checked-at").textContent = lastCheckedAt(m);
  renderLatestPanel();
  renderQualityPanel();
  renderQualityDashboard();
}

function renderLatestPanel() {
  const panel = $("#latest-panel");
  if (!panel) return;
  const latest = [...state.policies]
    .filter((p) => p.d)
    .sort((a, b) => b.d.localeCompare(a.d))
    .slice(0, 5);
  if (!latest.length) return;
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="latest-head">
      <div>
        <span>自动更新速览</span>
        <h2>最新政策文件</h2>
      </div>
      <p>按发文日期展示，来源于已过滤后的政策文件清单。</p>
    </div>
    <div class="latest-list">
      ${latest.map((p) => {
        const docNo = p.pcv || p.pc || "";
        const issuer = p.ogv || p.og || "";
        const route = p.tx ? [p.tx.ministryName, p.tx.bureauName, p.tx.office].filter(Boolean).join(" / ") : "";
        const theme = (p.th || [])[0] || "";
        const ministry = (p.tx?.ministryIds || [])[0] || "";
        const bureau = p.tx?.bureauId || "";
        const deptLabel = p.tx?.bureauName || p.tx?.ministryName || "";
        const actions = [
          `<button type="button" data-quick="year" data-year="${esc(String(p.y || ""))}">看${esc(String(p.y || ""))}年</button>`,
          theme ? `<button type="button" data-quick="theme" data-theme="${esc(theme)}">同主题</button>` : "",
          ministry ? `<button type="button" data-quick="dept" data-ministry="${esc(ministry)}" data-bureau="${esc(bureau)}">${esc(deptLabel ? `同${deptLabel}` : "同部门")}</button>` : "",
        ].filter(Boolean).join("");
        return `<article>
          <time>${esc(p.d || "")}</time>
          <a href="${esc(p.u)}" target="_blank" rel="noopener">${esc(displayTitle(p, docNo, issuer))}</a>
          <div>
            ${docNo ? `<span>${esc(docNo)}</span>` : ""}
            ${issuer ? `<span>${esc(issuer)}</span>` : ""}
            ${route ? `<span>${esc(route)}</span>` : ""}
          </div>
          <nav class="latest-actions">${actions}</nav>
        </article>`;
      }).join("")}
    </div>`;
}

function matchesDocState(p, stateName) {
  if (stateName === "doc_official") return p.pcs === "official_field";
  if (stateName === "doc_extracted") return p.pcv && p.pcs !== "official_field";
  if (stateName === "doc_missing") return !p.pcv;
  if (stateName === "org_official") return p.ogs === "official_field";
  if (stateName === "org_extracted") return p.ogv && p.ogs !== "official_field";
  if (stateName === "org_missing") return !p.ogv;
  return true;
}

function renderQualityPanel() {
  const m = state.meta;
  const panel = $("#quality-panel");
  if (!panel) return;
  const report = state.qualityReport || {};
  const route = m.route_count || {};
  const q = m.quality || {};
  const total = m.policy_total || m.total || 0;
  const items = [
    ["文号覆盖", `${(q.docOfficial || 0) + (q.docExtracted || 0)}/${total}`],
    ["机关覆盖", `${(q.orgOfficial || 0) + (q.orgExtracted || 0)}/${total}`],
    ["文号归口", route["文号归口"] || 0],
    ["机关归口", route["机关归口"] || 0],
    ["缺少文号", q.docMissing || 0],
    ["缺少机关", q.orgMissing || 0],
  ];
  panel.innerHTML = items.map(([label, value]) =>
    `<article><span>${esc(label)}</span><strong>${esc(String(value))}</strong></article>`
  ).join("") + `
    <div class="quality-report-line">
      <strong>审计状态：${esc(report.status || m.quality_status || "ok")}</strong>
      <span>${esc((report.warnings || []).join("；") || "暂无高风险异常")}</span>
    </div>`;
  $("#quality-details")?.classList.remove("hidden");
}

function taxonomyText(p) {
  if (!p.tx) return "";
  const officeSource = p.tx.officeSource === "official_unpublished" ? "官网未公开 处室未公开" : "官网处室";
  return `${p.tx.ministryName} ${p.tx.bureauName} ${p.tx.office} ${p.tx.assignment} ${p.tx.docPrefix || ""} ${officeSource} ${p.tx.evidence || ""}`;
}

function pct(n, d) {
  return d ? Math.round(n / d * 100) + "%" : "-";
}

function recentPolicyCount(days = 30) {
  const latest = latestPolicyDate();
  if (!latest || latest === "-") return 0;
  const end = new Date(latest + "T00:00:00");
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return state.policies.filter((p) => {
    if (!p.d) return false;
    const d = new Date(p.d + "T00:00:00");
    return d >= start && d <= end;
  }).length;
}

function renderQualityDashboard() {
  const box = $("#quality-dashboard");
  if (!box) return;
  const m = state.meta;
  const report = state.qualityReport || {};
  const q = m.quality || {};
  const total = m.policy_total || m.total || 0;
  const docKnown = (q.docOfficial || 0) + (q.docExtracted || 0);
  const orgKnown = (q.orgOfficial || 0) + (q.orgExtracted || 0);
  const strict = (m.route_count || {})["文号归口"] || 0;
  const inferred = (m.route_count || {})["机关归口"] || 0;
  const excludedAll = (m.excluded_total || 0) + (state.interpretations?.length || 0);
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="quality-dashboard-head">
      <div>
        <span>数据质量与更新状态</span>
        <h2>政策文件清洗、归口与更新监测</h2>
      </div>
      <p>更新时间 ${esc(lastCheckedAt(m))} · 最近30天政策 ${recentPolicyCount(30)} 篇</p>
    </div>
    <div class="quality-dashboard-grid">
      ${qualityCard("政策文件", total, "清洗后进入分析的正式政策文件")}
      ${qualityCard("排除内容", excludedAll, "解读、新闻、列表页、客户端下载页等不作为独立政策收录")}
      ${qualityCard("文号覆盖", pct(docKnown, total), `${docKnown}/${total}`)}
      ${qualityCard("机关覆盖", pct(orgKnown, total), `${orgKnown}/${total}`)}
      ${qualityCard("文号严格归口", pct(strict, total), `${strict}/${total}`)}
      ${qualityCard("机关补充归口", inferred, "用于补足无法按文号判断的文件")}
    </div>
    ${(report.warnings || []).length ? `<div class="quality-alert">${esc(report.warnings.join("；"))}</div>` : ""}
    <div class="quality-dashboard-actions">
      <button type="button" data-quality-filter="doc_missing">查看缺少文号</button>
      <button type="button" data-quality-filter="org_missing">查看缺少机关</button>
      <button type="button" data-quality-filter="doc_strict">仅看文号严格归口</button>
    </div>`;
  box.querySelectorAll("button[data-quality-filter]").forEach((b) =>
    b.addEventListener("click", () => {
      showView("browse");
      if (b.dataset.qualityFilter === "doc_missing") {
        resetBrowseControls();
        $("#f-doc-state").value = "doc_missing";
      } else if (b.dataset.qualityFilter === "org_missing") {
        resetBrowseControls();
        $("#f-doc-state").value = "org_missing";
      } else {
        resetBrowseControls();
        $("#f-route-mode").value = "doc_strict";
      }
      applyFilters();
      $("#view-browse")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
}

function qualityCard(label, value, note) {
  return `<article><span>${esc(label)}</span><strong>${esc(String(value))}</strong><em>${esc(note)}</em></article>`;
}

function highlight(text, q) {
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + q.length)) +
    "</mark>" + esc(text.slice(i + q.length));
}

function removeRepeatedLead(text, parts) {
  let out = (text || "").trim();
  const compact = (s) => (s || "").replace(/\s+/g, "").replace(/[　\s:：，,。；;、]+$/g, "");
  parts.filter(Boolean).sort((a, b) => b.length - a.length).forEach((part) => {
    const raw = (part || "").trim();
    const simple = compact(raw);
    if (!out || !simple) return;
    const outSimple = compact(out);
    if (out.startsWith(raw)) {
      out = out.slice(raw.length).replace(/^[\s　:：，,。；;、-]+/, "");
    } else if (outSimple.startsWith(simple) && simple.length > 8) {
      out = out.replace(new RegExp("^.{0," + Math.min(raw.length + 12, out.length) + "}?[\\s　:：，,。；;、-]*"), "");
    }
  });
  return out.trim();
}

function cleanSummary(p, docNo, issuer) {
  let summary = removeRepeatedLead(p.s || "", [p.t, docNo, issuer]);
  const intent = summary.search(/[为根依按现]/);
  if (intent > 20 && intent < 160) summary = summary.slice(intent);
  if (!summary || summary.length < 12) return "";
  return summary.length > 180 ? summary.slice(0, 180).trim() + "…" : summary;
}

function displayTitle(p, docNo, issuer) {
  let title = (p.t || "").trim();
  if (docNo) title = title.replace(docNo, "").replace(/\s{2,}/g, " ").trim();
  const aboutIdx = title.indexOf("关于");
  if (aboutIdx > 8 && title.length - aboutIdx > 8) {
    title = title.slice(aboutIdx).trim();
  }
  const issuers = (issuer || "").split(/[、，,]\s*/).filter((x) => x.length > 3);
  issuers.sort((a, b) => b.length - a.length).forEach((name) => {
    if (title.startsWith(name) && title.length - name.length > 8) {
      title = title.slice(name.length).replace(/^[\s　:：，,。；;、-]+/, "");
    }
  });
  return title || p.t || "";
}

function relationReasons(policy, candidate) {
  const reasons = [];
  if (policy.tx?.bureauId && policy.tx?.bureauId === candidate.tx?.bureauId) {
    reasons.push(policy.tx?.office && policy.tx.office === candidate.tx?.office ? "同处室" : "同司局");
  } else if ((policy.tx?.ministryIds || []).some((id) => (candidate.tx?.ministryIds || []).includes(id))) {
    reasons.push("同部委");
  }
  const sharedThemes = (policy.th || []).filter((theme) => (candidate.th || []).includes(theme));
  sharedThemes.slice(0, 2).forEach((theme) => reasons.push(theme));
  return reasons;
}

function relatedPolicies(policy, limit = 3) {
  return state.policies
    .filter((candidate) => candidate.id !== policy.id)
    .map((candidate) => {
      const reasons = relationReasons(policy, candidate);
      if (!reasons.length) return null;
      let score = reasons.reduce((sum, reason) => {
        if (reason === "同处室") return sum + 8;
        if (reason === "同司局") return sum + 5;
        if (reason === "同部委") return sum + 2;
        return sum + 3;
      }, 0);
      if (candidate.d && policy.d && candidate.d <= policy.d) score += 1;
      return { policy: candidate, reasons: reasons.slice(0, 3), score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || (b.policy.d || "").localeCompare(a.policy.d || ""))
    .slice(0, limit);
}

function relatedHTML(policy) {
  const related = relatedPolicies(policy, 3);
  if (!related.length) return "";
  return `<details class="related-row"><summary>相关文件 <span>${related.length}</span></summary>${related.map(({ policy: item, reasons }) => {
    const docNo = item.pcv || item.pc || "";
    const issuer = item.ogv || item.og || "";
    return `<a href="${esc(item.u)}" target="_blank" rel="noopener">
      <strong>${esc(displayTitle(item, docNo, issuer))}</strong>
      <em>${esc(reasons.join(" / "))}</em>
    </a>`;
  }).join("")}</details>`;
}

function itemHTML(p, q, options = {}) {
  const docNo = p.pcv || p.pc || "";
  const issuer = p.ogv || p.og || "";
  const title = displayTitle(p, docNo, issuer);
  const themes = (p.th || []).map((t) => `<span class="th-chip">${esc(t)}</span>`).join("");
  const primaryMinistry = (p.tx?.ministryIds || [p.tx?.ministryId || ""])[0] || "";
  const taxonomy = p.tx
    ? `<div class="policy-route" aria-label="归口筛选">
        <span>归口</span>
        ${primaryMinistry ? `<button type="button" data-quick="ministry" data-ministry="${esc(primaryMinistry)}">${esc(p.tx.ministryName)}</button>` : ""}
        ${p.tx.bureauId ? `<button type="button" data-quick="bureau" data-ministry="${esc(primaryMinistry)}" data-bureau="${esc(p.tx.bureauId)}">${esc(p.tx.bureauName)}</button>` : ""}
        ${p.tx.office ? `<button type="button" data-quick="office" data-ministry="${esc(primaryMinistry)}" data-bureau="${esc(p.tx.bureauId || "")}" data-office="${esc(p.tx.office)}">${esc(p.tx.office)}</button>` : ""}
        <em>${esc(p.tx.assignment)}</em>
      </div>`
    : "";
  const routeEvidence = p.tx
    ? `<div class="route-evidence">
        ${p.tx.docNo ? `<span>文号：${esc(p.tx.docNo)}</span>` : ""}
        ${p.tx.docPrefix ? `<span>前缀：${esc(p.tx.docPrefix)}</span>` : ""}
        ${p.tx.officeSource === "official_unpublished" ? `<span>处室：官网未公开，按司局归口</span>` : ""}
        ${p.tx.evidence ? `<span>${esc(p.tx.evidence)}</span>` : ""}
        ${p.tx.confidence ? `<span>置信度：${esc(String(Math.round(Number(p.tx.confidence) * 100)))}%</span>` : ""}
      </div>`
    : "";
  const interps = (p.interps || []).slice(0, 4).map((item) =>
    `<a href="${esc(item.u)}" target="_blank" rel="noopener"><strong>${esc(item.t)}</strong><span>${esc(item.d || "")}</span></a>`
  ).join("");
  const summary = cleanSummary(p, docNo, issuer);
  return `<li class="item">
    <h3 class="policy-title"><a href="${esc(p.u)}" target="_blank" rel="noopener">${highlight(title, q)}</a></h3>
    ${docNo ? `<div class="policy-docno">${esc(docNo)}</div>` : ""}
    <dl class="policy-fields">
      <div><dt>发文机关</dt><dd>${issuer ? esc(issuer) : "未标注"}</dd></div>
      <div><dt>发文日期</dt><dd>${p.d ? esc(p.d) : "未标注"}</dd></div>
    </dl>
    ${taxonomy}
    ${routeEvidence}
    ${themes ? `<div class="th-row">${themes}</div>` : ""}
    ${summary ? `<p class="summary">${highlight(summary, q)}</p>` : ""}
    ${interps ? `<div class="interp-row"><span>政策解读</span>${interps}</div>` : ""}
    ${options.related ? relatedHTML(p) : ""}
  </li>`;
}

function hasActiveBrowseFilter(q) {
  return q || ["#f-year", "#f-theme", "#f-ministry", "#f-bureau", "#f-office", "#f-route", "#f-doc-state"]
    .some((s) => $(s).value) || routeMode() !== "doc_strict";
}

function renderActiveFilters(q) {
  const box = $("#active-filters");
  const items = activeFilterItems(q);
  const advancedCount = items.filter(([key]) => ["route", "doc-state"].includes(key)).length;
  const advancedBadge = $("#advanced-filter-count");
  if (advancedBadge) {
    advancedBadge.textContent = advancedCount ? `${advancedCount}` : "";
    advancedBadge.classList.toggle("hidden", !advancedCount);
  }
  if (!box) return;
  if (!items.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = items.map(([key, label, value]) =>
    `<button type="button" data-clear="${esc(key)}"><span>${esc(label)}</span>${esc(value)}</button>`
  ).join("") + `<button type="button" class="clear-all" data-clear="all">重置筛选</button>`;
}

function renderList() {
  const qText = $("#q").value.trim();
  const q = qText.toLowerCase();
  const total = state.filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE;
  const slice = state.filtered.slice(start, start + PAGE);
  renderActiveFilters(qText);
  updateDepartmentHint(total);
  const modeLabel = routeMode() === "doc_strict" ? "文号严格对应" : "含机关识别补充";
  $("#result-info").textContent = `共 ${total} 篇 · ${modeLabel}` + (hasActiveBrowseFilter(q) ? "（已筛选）" : "");
  $("#list").innerHTML = slice.map((p) => itemHTML(p, q, { related: true })).join("") ||
    `<li class="item muted">没有匹配的政策，换个关键词试试。</li>`;
  renderPager(pages);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderPager(pages) {
  if (pages <= 1) { $("#pager").innerHTML = ""; return; }
  const cur = state.page;
  const nums = new Set([1, pages, cur, cur - 1, cur + 1, cur - 2, cur + 2]);
  let html = `<button ${cur === 1 ? "disabled" : ""} data-p="${cur - 1}">上一页</button>`;
  let prev = 0;
  [...nums].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b).forEach((n) => {
    if (n - prev > 1) html += `<span class="muted">…</span>`;
    html += `<button class="${n === cur ? "active" : ""}" data-p="${n}">${n}</button>`;
    prev = n;
  });
  html += `<button ${cur === pages ? "disabled" : ""} data-p="${cur + 1}">下一页</button>`;
  $("#pager").innerHTML = html;
  $("#pager").querySelectorAll("button[data-p]").forEach((b) =>
    b.addEventListener("click", () => { state.page = +b.dataset.p; renderList(); }));
}

/* ---------- Trend ---------- */
const PALETTE = ["#0b6e5f", "#1d6fb8", "#c2410c", "#7c3aed", "#be123c", "#0891b2",
  "#65a30d", "#b45309", "#db2777", "#4f46e5", "#0d9488", "#9333ea",
  "#0e7490", "#a21caf", "#ca8a04", "#dc2626", "#2563eb", "#16a34a",
  "#7c2d12", "#5b21b6"];

const CUSTOM_PALETTE = ["#111827", "#b91c1c", "#1e40af", "#6d28d9", "#a16207",
  "#0f766e", "#9d174d", "#3f6212"];
const FORECAST_RULES = [
  {
    keys: ["分级诊疗", "基层", "医共体", "县域", "家庭医生"],
    title: "基层整合与连续服务",
    items: [
      ["运行评价", "政策重点会从建设框架转向监测指标、绩效评价和连续服务质量。"],
      ["资源下沉", "基层能力、县域协同、检查检验共享和人员流动仍是观察主线。"],
      ["医保协同", "支付方式、总额预算和基金监管会更深嵌入基层治理。"]
    ]
  },
  {
    keys: ["医保", "医疗保障", "目录", "支付", "DRG", "DIP", "集采"],
    title: "医保支付与基金治理",
    items: [
      ["动态调整", "目录、价格和支付政策将继续向精细化、动态化和证据化演进。"],
      ["多元支付", "DRG/DIP、长期护理保险和商保衔接会影响服务供给结构。"],
      ["智能监管", "基金监管会更依赖数据筛查、信用管理和闭环整改。"]
    ]
  },
  {
    keys: ["疾控", "公共卫生", "传染病", "疫情", "应急"],
    title: "公共卫生与监测预警",
    items: [
      ["监测预警", "政策会继续强化多点触发、风险评估和跨部门信息共享。"],
      ["医防协同", "疾控体系与医疗机构之间的分工、转介和数据闭环会更清晰。"],
      ["平急结合", "应急处置、物资储备、队伍建设和常态防控会继续并行。"]
    ]
  },
  {
    keys: ["老龄", "医养", "护理", "康复", "安宁疗护", "长期护理"],
    title: "老龄健康与护理服务",
    items: [
      ["服务扩容", "护理、康复、安宁疗护和居家服务会向社区与家庭延伸。"],
      ["支付衔接", "长期护理保险、医疗服务价格和养老服务支付会继续联动。"],
      ["人才建设", "专科护士、护理质量控制和基层照护队伍会成为持续主题。"]
    ]
  }
];
state.customLines = []; // {label, words, color}
state.showPresets = true;
state.relMode = "all"; // 'all' = 标题+摘要；'strong' = 仅标题强相关
state.viewMode = "count"; // 'count' 数量折线 | 'share' 占比堆叠

function initTrend() {
  const pick = $("#theme-pick");
  Object.keys(state.trends.themes).forEach((t) =>
    pick.insertAdjacentHTML("beforeend", `<option value="${esc(t)}">${esc(t)}</option>`));
  pick.addEventListener("change", () => renderThemeList(pick.value));
  renderThemeList(Object.keys(state.trends.themes)[0]);

  // 自定义关键词
  const add = () => addCustomKeyword($("#kw-input").value);
  $("#kw-add").addEventListener("click", add);
  $("#kw-input").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  $("#kw-input").addEventListener("input", updateSuggest);
  $("#show-presets").addEventListener("change", (e) => {
    state.showPresets = e.target.checked;
    refreshChart();
  });
  // 相关口径切换
  document.querySelectorAll('input[name="relmode"]').forEach((r) =>
    r.addEventListener("change", (e) => {
      if (!e.target.checked) return;
      state.relMode = e.target.value;
      refreshChart();
      renderChips();
      renderThemeList($("#theme-pick").value);
    }));
  // 视图切换：数量 / 占比
  document.querySelectorAll('input[name="viewmode"]').forEach((r) =>
    r.addEventListener("change", (e) => {
      if (!e.target.checked) return;
      state.viewMode = e.target.value;
      rebuildChart();
    }));
  initAnalysisLab();
  renderAnalysisLab();
}

function initAnalysisLab() {
  const input = $("#insight-keyword");
  const run = $("#insight-run");
  if (!input || !run) return;
  const apply = () => {
    const value = input.value.trim() || "医共体";
    input.value = value;
    renderAnalysisLab(value);
    addCustomKeyword(value);
  };
  run.addEventListener("click", apply);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(); });
}

function renderAnalysisLab(keyword = $("#insight-keyword")?.value || "医共体") {
  renderKeywordInsight(keyword);
  renderThemeHeatmap();
  renderDeptThemeMatrix();
  renderPolicyNetwork(keyword);
}

function splitWords(raw) {
  return (raw || "").split(/[，,\s]+/).map((w) => w.trim()).filter(Boolean);
}

const KEYWORD_SYNONYMS = {
  "医共体": ["医疗卫生共同体", "县域医共体", "紧密型县域", "紧密型医疗卫生共同体"],
  "区域医疗中心": ["国家区域医疗中心", "省级区域医疗中心", "医疗中心设置标准", "优质医疗资源扩容"],
  "护理": ["护士", "护理服务", "老年护理", "互联网+护理", "长期护理", "护理院"],
  "长护险": ["长期护理保险", "长期护理"],
  "长期护理保险": ["长护险", "长期护理"],
  "分级诊疗": ["医联体", "医共体", "医疗联合体", "双向转诊"],
  "医保支付": ["DRG", "DIP", "支付方式", "按病种付费", "总额预算"],
  "数字健康": ["信息化", "互联网医疗", "远程医疗", "健康医疗大数据", "智慧医院"],
};

const POLICY_PHASES = [
  { name: "医改奠基期", years: [2009, 2015], note: "以基本制度、服务体系和基层能力建设为主" },
  { name: "战略成型期", years: [2016, 2018], note: "健康中国、分级诊疗和资源布局进入系统部署" },
  { name: "行动扩展期", years: [2019, 2021], note: "专项行动、疫情防控、绩效评价和高质量发展叠加推进" },
  { name: "深化治理期", years: [2022, 2026], note: "资源均衡、数字治理、三医协同和精细化监管加强" },
];

function expandWords(words) {
  const all = [];
  words.forEach((w) => {
    all.push(w);
    (KEYWORD_SYNONYMS[w] || []).forEach((s) => all.push(s));
  });
  return [...new Set(all.filter(Boolean))];
}

function policyText(p) {
  return `${p.t || ""} ${p.s || ""} ${p.pc || ""} ${p.pcv || ""} ${p.og || ""} ${p.ogv || ""} ${(p.th || []).join(" ")} ${taxonomyText(p)}`;
}

function keywordMatchedPolicies(keyword) {
  const words = expandWords(splitWords(keyword));
  if (!words.length) return [];
  return state.policies.filter((p) => {
    const text = policyText(p).toLowerCase();
    return words.some((w) => text.includes(w.toLowerCase()));
  });
}

function groupCount(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const raw = keyFn(item);
    const keys = Array.isArray(raw) ? raw : [raw];
    keys.filter(Boolean).forEach((key) => map.set(key, (map.get(key) || 0) + 1));
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function stageText(years, counts) {
  const first = years.find((y) => counts[y]);
  const latest = [...years].reverse().find((y) => counts[y]);
  const lastYear = years[years.length - 1];
  const recent = years.slice(-3).reduce((sum, y) => sum + (counts[y] || 0), 0);
  const prev = years.slice(-6, -3).reduce((sum, y) => sum + (counts[y] || 0), 0);
  let status = "观察期";
  if (recent >= prev && recent >= 6) status = "持续深化";
  else if (recent > 0 && prev > recent) status = "规范完善";
  else if (!recent && latest && latest < lastYear - 2) status = "阶段性沉淀";
  return { first: first || "-", latest: latest || "-", recent, prev, status };
}

function renderKeywordInsight(keyword) {
  const box = $("#keyword-insight");
  if (!box) return;
  const timeline = state.keywordTimelines?.topics?.[keyword] || null;
  const hits = keywordMatchedPolicies(keyword);
  const years = state.trends.years;
  const counts = Object.fromEntries(years.map((y) => [y, 0]));
  hits.forEach((p) => { counts[p.y] = (counts[p.y] || 0) + 1; });
  const max = Math.max(1, ...years.map((y) => counts[y] || 0));
  const stage = stageText(years, counts);
  const themes = groupCount(hits, (p) => p.th || []).slice(0, 5);
  const orgs = groupCount(hits, (p) => p.ogv || p.og || "未标注").slice(0, 5);
  const routes = groupCount(hits.filter((p) => p.tx?.bureauName), (p) =>
    [p.tx.ministryName, p.tx.bureauName].filter(Boolean).join(" / ")).slice(0, 5);
  const peak = years.map((y) => [y, counts[y] || 0]).sort((a, b) => b[1] - a[1])[0] || ["-", 0];
  const yearly = years.map((y) => {
    const n = counts[y] || 0;
    return `<button type="button" class="${n ? "has-hit" : ""}" data-year="${y}" data-theme="" style="--h:${Math.max(4, Math.round(n / max * 100))}%"><span>${n}</span><em>${y}</em></button>`;
  }).join("");
  const recentPolicies = hits.sort((a, b) => b.d.localeCompare(a.d)).slice(0, 6);
  box.innerHTML = `
    <div class="insight-stats">
      <article><span>命中文件</span><strong>${hits.length}</strong></article>
      <article><span>首次出现</span><strong>${stage.first}</strong></article>
      <article><span>最近年份</span><strong>${stage.latest}</strong></article>
      <article><span>峰值年份</span><strong>${peak[0]} · ${peak[1]}</strong></article>
    </div>
    <div class="insight-action-row">
      <span>当前判断：<strong>${esc(stage.status)}</strong> · 近三年 ${stage.recent} 篇，前三年 ${stage.prev} 篇${timeline ? " · 已生成专题脉络数据" : ""}</span>
      <button type="button" data-insight-action="browse">进入政策清单</button>
      <button type="button" data-insight-action="export">导出专题简报</button>
    </div>
    <div class="insight-bars" aria-label="${esc(keyword)}年度政策数量">${yearly}</div>
    ${phaseTimelineHTML(hits, keyword)}
    <div class="insight-columns">
      ${insightRankHTML("相关主题", themes)}
      ${insightRankHTML("主要机关", orgs)}
      ${insightRankHTML("归口司局", routes)}
    </div>
    ${departmentShiftHTML(hits)}
    <div class="insight-policies">
      <strong>近期代表文件</strong>
      ${recentPolicies.length ? recentPolicies.map((p) =>
        `<a href="${esc(p.u)}" target="_blank" rel="noopener"><span>${esc(p.d || "")}</span>${highlight(p.t, keyword)}<em>${esc(p.pcv || p.pc || "")}</em></a>`
      ).join("") : `<p class="muted">暂无命中文件，可换一个关键词。</p>`}
    </div>`;
  box.querySelectorAll(".insight-bars button[data-year]").forEach((b) =>
    b.addEventListener("click", () => {
      showView("browse");
      applyQuickFilter({ year: b.dataset.year });
      $("#q").value = keyword;
      applyFilters();
    }));
  box.querySelectorAll("button[data-insight-action]").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.insightAction === "browse") {
        showView("browse");
        resetBrowseControls();
        $("#q").value = keyword;
        state.filtered = keywordMatchedPolicies(keyword)
          .sort((a, b) => b.d.localeCompare(a.d));
        state.page = 1;
        renderList();
        $("#result-info").textContent = `共 ${state.filtered.length} 篇 · 专题同义词口径 · ${keyword}`;
        $("#view-browse")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        exportKeywordBrief(keyword, hits, counts, themes, orgs, routes, stage, peak);
      }
    }));
  box.querySelectorAll("button[data-phase-filter]").forEach((b) =>
    b.addEventListener("click", () => {
      const [start, end] = b.dataset.phaseFilter.split("-").map(Number);
      showView("browse");
      resetBrowseControls();
      $("#q").value = b.dataset.keyword || keyword;
      state.filtered = keywordMatchedPolicies(keyword)
        .filter((p) => p.y >= start && p.y <= end)
        .sort((a, b) => b.d.localeCompare(a.d));
      state.page = 1;
      renderList();
      $("#result-info").textContent = `共 ${state.filtered.length} 篇 · ${start}-${end} · ${keyword}`;
      $("#view-browse")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
}

function insightRankHTML(title, rows) {
  return `<article><strong>${esc(title)}</strong>` +
    (rows.length ? rows.map(([name, n]) =>
      `<div><span>${esc(name)}</span><em>${n}</em></div>`).join("") : `<p class="muted">暂无数据</p>`) +
    `</article>`;
}

function phaseTimelineHTML(hits, keyword) {
  const total = hits.length || 1;
  const cards = POLICY_PHASES.map((phase) => {
    const [start, end] = phase.years;
    const items = hits.filter((p) => p.y >= start && p.y <= end);
    const topThemes = groupCount(items, (p) => p.th || []).slice(0, 2).map(([name]) => name).join("、") || "暂无";
    const lead = items.slice().sort((a, b) => b.d.localeCompare(a.d))[0];
    return `<article data-phase-start="${start}" data-phase-end="${end}">
      <div><span>${start}-${end}</span><strong>${esc(phase.name)}</strong></div>
      <em>${items.length}篇 · ${Math.round(items.length / total * 100)}%</em>
      <p>${esc(phase.note)}</p>
      <small>主题：${esc(topThemes)}</small>
      ${lead ? `<button type="button" data-phase-filter="${start}-${end}" data-keyword="${esc(keyword)}">看本阶段文件</button>` : ""}
    </article>`;
  }).join("");
  return `<div class="phase-timeline">${cards}</div>`;
}

function departmentShiftHTML(hits) {
  const blocks = POLICY_PHASES.map((phase) => {
    const [start, end] = phase.years;
    const items = hits.filter((p) => p.y >= start && p.y <= end);
    const rows = groupCount(items.filter((p) => p.tx?.bureauName), (p) =>
      [p.tx.ministryName, p.tx.bureauName].filter(Boolean).join(" / ")).slice(0, 3);
    return `<article>
      <strong>${esc(phase.name)}</strong>
      ${rows.length ? rows.map(([name, n]) => `<div><span>${esc(name)}</span><em>${n}</em></div>`).join("") : `<p class="muted">暂无明确司局归口</p>`}
    </article>`;
  }).join("");
  return `<div class="dept-shift"><h3>部门重心变化</h3><div>${blocks}</div></div>`;
}

function keywordBriefMarkdown(keyword, hits, counts, themes, orgs, routes, stage, peak) {
  const lines = [
    `# ${keyword}政策演进专题简报`,
    "",
    `- 命中文件：${hits.length}篇`,
    `- 首次出现：${stage.first}`,
    `- 最近年份：${stage.latest}`,
    `- 峰值年份：${peak[0]}（${peak[1]}篇）`,
    `- 当前判断：${stage.status}`,
    "",
    "## 主要主题",
    ...themes.map(([name, n]) => `- ${name}：${n}篇`),
    "",
    "## 主要发文机关",
    ...orgs.map(([name, n]) => `- ${name}：${n}篇`),
    "",
    "## 主要归口司局",
    ...(routes.length ? routes.map(([name, n]) => `- ${name}：${n}篇`) : ["- 暂无明确司局归口"]),
    "",
    "## 年度分布",
    ...state.trends.years.map((y) => `- ${y}：${counts[y] || 0}篇`),
    "",
    "## 近期代表文件",
    ...hits.slice().sort((a, b) => b.d.localeCompare(a.d)).slice(0, 10).map((p) =>
      `- ${p.d || ""} ${p.t}${p.pcv || p.pc ? `（${p.pcv || p.pc}）` : ""} ${p.u || ""}`)
  ];
  return lines.join("\n");
}

function exportKeywordBrief(keyword, hits, counts, themes, orgs, routes, stage, peak) {
  const md = keywordBriefMarkdown(keyword, hits, counts, themes, orgs, routes, stage, peak);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${keyword.replace(/[\\/:*?"<>|]/g, "_")}-政策演进专题简报.md`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function renderThemeHeatmap() {
  const box = $("#theme-heatmap");
  if (!box) return;
  const years = state.trends.years;
  const rows = Object.entries(state.trends.themes).slice(0, 12);
  const max = Math.max(1, ...rows.flatMap(([, d]) => d.series));
  box.innerHTML = `
    <div class="heatmap-years">${years.map((y) => `<span>${y}</span>`).join("")}</div>
    ${rows.map(([name, data]) => `
      <div class="heatmap-row">
        <button type="button" data-theme="${esc(name)}">${esc(name)}</button>
        <div>
          ${data.series.map((n, i) =>
            `<span style="--v:${(n / max).toFixed(3)}" title="${esc(name)} ${years[i]}：${n}篇">${n || ""}</span>`
          ).join("")}
        </div>
      </div>`).join("")}`;
  box.querySelectorAll("button[data-theme]").forEach((b) =>
    b.addEventListener("click", () => {
      $("#theme-pick").value = b.dataset.theme;
      renderThemeList(b.dataset.theme);
      showThemeLine(b.dataset.theme);
    }));
}

function renderDeptThemeMatrix() {
  const box = $("#dept-theme-matrix");
  if (!box) return;
  const strict = state.policies.filter((p) => p.tx?.assignment === "文号归口" && p.tx?.bureauName);
  const bureaus = groupCount(strict, (p) => p.tx.bureauName).slice(0, 9).map(([name]) => name);
  const themes = Object.entries(state.trends.themes).slice(0, 8).map(([name]) => name);
  const rows = bureaus.map((bureau) => {
    const values = themes.map((theme) => strict.filter((p) => p.tx?.bureauName === bureau && (p.th || []).includes(theme)).length);
    return { bureau, values };
  });
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  box.innerHTML = `
    <div class="matrix-head"><span></span>${themes.map((t) => `<span>${esc(t)}</span>`).join("")}</div>
    ${rows.map((r) => `
      <div class="matrix-row">
        <button type="button" data-bureau="${esc(r.bureau)}">${esc(r.bureau)}</button>
        ${r.values.map((n, i) =>
          `<span style="--v:${(n / max).toFixed(3)}" title="${esc(r.bureau)} / ${esc(themes[i])}：${n}篇">${n || ""}</span>`
        ).join("")}
      </div>`).join("")}`;
  box.querySelectorAll("button[data-bureau]").forEach((b) =>
    b.addEventListener("click", () => {
      const bureau = window.POLICY_TAXONOMY.bureaus.find((item) => item.name === b.dataset.bureau);
      if (!bureau) return;
      showView("browse");
      resetBrowseControls();
      $("#f-route-mode").value = "doc_strict";
      $("#f-ministry").value = bureau.ministry;
      renderBureauOptions();
      $("#f-bureau").value = bureau.id;
      renderOfficeOptions();
      applyFilters();
    }));
}

function relationReasons(a, b) {
  const reasons = [];
  if (a.tx?.bureauId && a.tx.bureauId === b.tx?.bureauId) reasons.push("同司局");
  if (a.tx?.office && a.tx.office === b.tx?.office) reasons.push("同处室");
  const sharedThemes = (a.th || []).filter((t) => (b.th || []).includes(t));
  if (sharedThemes.length) reasons.push(`同主题：${sharedThemes.slice(0, 2).join("、")}`);
  const docA = (a.pcv || a.pc || "").slice(0, 4);
  const docB = (b.pcv || b.pc || "").slice(0, 4);
  if (docA && docA === docB) reasons.push("同文号体系");
  return reasons;
}

function renderPolicyNetwork(keyword) {
  const box = $("#policy-network");
  if (!box) return;
  const hits = keywordMatchedPolicies(keyword)
    .sort((a, b) => b.d.localeCompare(a.d))
    .slice(0, 12);
  if (hits.length < 2) {
    box.innerHTML = `<p class="muted">命中文件不足，暂不能形成关系网络。</p>`;
    return;
  }
  const nodes = hits.map((p, i) => {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / hits.length;
    const r = i ? 118 : 0;
    return {
      p, i,
      x: Math.round(320 + Math.cos(angle) * r),
      y: Math.round(155 + Math.sin(angle) * r),
    };
  });
  const idIndex = new Map(hits.map((p, i) => [p.id, i]));
  const precomputed = (state.relationships?.edges || [])
    .filter((e) => idIndex.has(e.source) && idIndex.has(e.target))
    .map((e) => ({ i: idIndex.get(e.source), j: idIndex.get(e.target), reasons: e.reasons || [], w: e.score || 1 }));
  const edges = precomputed.length ? precomputed : [];
  if (!edges.length) {
    for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        const reasons = relationReasons(hits[i], hits[j]);
        if (reasons.length) edges.push({ i, j, reasons, w: reasons.length });
      }
    }
  }
  edges.sort((a, b) => b.w - a.w);
  const shownEdges = edges.slice(0, 24);
  const edgeList = shownEdges.slice(0, 8).map((e) => {
    const a = hits[e.i], b = hits[e.j];
    return `<li><span>${esc(e.reasons.join(" / "))}</span><strong>${esc(shortTitle(a.t))}</strong><em>${esc(shortTitle(b.t))}</em></li>`;
  }).join("");
  box.innerHTML = `
    <svg viewBox="0 0 640 320" role="img" aria-label="${esc(keyword)}政策关系网络">
      <g class="network-edges">
        ${shownEdges.map((e) => {
          const a = nodes[e.i], b = nodes[e.j];
          return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" style="--w:${e.w}"><title>${esc(e.reasons.join(" / "))}</title></line>`;
        }).join("")}
      </g>
      <g class="network-nodes">
        ${nodes.map((n) => `
          <a href="${esc(n.p.u)}" target="_blank" rel="noopener">
            <circle cx="${n.x}" cy="${n.y}" r="${n.i ? 9 : 13}"><title>${esc(n.p.t)}</title></circle>
          </a>`).join("")}
      </g>
    </svg>
    <ol class="network-list">${edgeList || `<li><span>关系较弱</span><strong>建议增加关键词范围</strong><em>或切换主题</em></li>`}</ol>`;
}

function shortTitle(text) {
  const s = text || "";
  return s.length > 24 ? s.slice(0, 24) + "…" : s;
}

// 自定义词 → 相关 AI 主题联想（静态站内的“语义桥接”：把任意输入词引导到最相关的主题曲线）
function suggestThemes(text) {
  const t = (text || "").trim();
  if (t.length < 2) return [];
  return Object.keys(state.trends.themes).filter((name) =>
    name.includes(t) || (state.trends.themes[name].desc || "").includes(t));
}

function updateSuggest() {
  const box = $("#kw-suggest");
  const ms = suggestThemes($("#kw-input").value);
  if (!ms.length) { box.innerHTML = ""; return; }
  box.innerHTML = '<span class="muted">相关 AI 主题：</span>' +
    ms.slice(0, 4).map((n) => `<button class="sugg" data-th="${esc(n)}">${esc(n)} ↗</button>`).join("");
  box.querySelectorAll("button[data-th]").forEach((b) =>
    b.addEventListener("click", () => showThemeLine(b.dataset.th)));
}

// 在图中高亮某个 AI 主题曲线（取消其默认隐藏），并滚动到图表
function showThemeLine(name) {
  if (!$("#show-presets").checked) { $("#show-presets").checked = true; state.showPresets = true; }
  refreshChart();
  if (state.chart) {
    const ds = state.chart.data.datasets.find((d) => d.label === name);
    if (ds) { ds.hidden = false; state.chart.update(); }
  }
  const box = document.querySelector(".chart-box");
  if (box) box.scrollIntoView({ behavior: "smooth", block: "center" });
}

// 某篇政策是否命中某组词；mode='strong' 只看标题，'all' 看标题+摘要
function hitMode(p, words, mode) {
  const expanded = expandWords(words);
  const title = (p.t || "").toLowerCase();
  const summary = (p.s || "").toLowerCase();
  if (expanded.some((w) => title.includes(w.toLowerCase()))) return "strong";
  if (mode === "all" && expanded.some((w) => summary.includes(w.toLowerCase()))) return "weak";
  return null;
}

// 在已加载的政策语料上，按当前口径实时算出某组词逐年命中数
function computeSeries(words, mode) {
  const idx = {};
  state.trends.years.forEach((y) => (idx[y] = 0));
  let total = 0;
  for (const p of state.policies) {
    if (hitMode(p, words, mode)) {
      if (idx[p.y] !== undefined) idx[p.y]++;
      total++;
    }
  }
  return { series: state.trends.years.map((y) => idx[y]), total };
}

function addCustomKeyword(raw) {
  const text = (raw || "").trim();
  if (!text) return;
  const words = text.split(/[，,]/).map((w) => w.trim()).filter(Boolean);
  const label = words.join("/");
  if (state.customLines.some((c) => c.label === label)) { $("#kw-input").value = ""; return; }
  const color = CUSTOM_PALETTE[state.customLines.length % CUSTOM_PALETTE.length];
  state.customLines.push({ label, words, color });
  $("#kw-input").value = "";
  renderChips();
  refreshChart();
}

function removeCustomKeyword(label) {
  state.customLines = state.customLines.filter((c) => c.label !== label);
  renderChips();
  refreshChart();
}

function renderChips() {
  $("#kw-chips").innerHTML = state.customLines.map((c) => {
    const total = computeSeries(c.words, state.relMode).total;
    return `<span class="kwchip" style="background:${c.color}">${esc(c.label)}（${total}）` +
      `<button data-kw="${esc(c.label)}" title="移除">×</button></span>`;
  }).join("");
  $("#kw-chips").querySelectorAll("button[data-kw]").forEach((b) =>
    b.addEventListener("click", () => removeCustomKeyword(b.dataset.kw)));
}

function buildDatasets() {
  if (state.viewMode === "share") return buildShareDatasets();
  const tr = state.trends;
  const presets = state.showPresets ? Object.entries(tr.themes).map(([name, d], i) => ({
    label: name,
    data: d.series,
    borderColor: PALETTE[i % PALETTE.length],
    backgroundColor: PALETTE[i % PALETTE.length],
    tension: 0.3, borderWidth: 2, pointRadius: 2,
    hidden: i >= 8,
  })) : [];
  const customs = state.customLines.map((c) => ({
    label: "★" + c.label,
    data: computeSeries(c.words, state.relMode).series,
    borderColor: c.color,
    backgroundColor: c.color,
    tension: 0.3, borderWidth: 3, pointRadius: 3, borderDash: [6, 3],
  }));
  return presets.concat(customs);
}

// 占比视图：每年各主题标签占该年全部主题标签的百分比，堆叠面积（各年和≈100%），
// 看政策重心的结构性转移，而非绝对数量。不含自定义关键词曲线。
function buildShareDatasets() {
  const tr = state.trends;
  const totals = tr.years.map((_, i) =>
    Object.values(tr.themes).reduce((s, d) => s + d.series[i], 0));
  return Object.entries(tr.themes).map(([name, d], i) => ({
    label: name,
    data: d.series.map((v, j) => (totals[j] ? +(v / totals[j] * 100).toFixed(1) : 0)),
    borderColor: PALETTE[i % PALETTE.length],
    backgroundColor: PALETTE[i % PALETTE.length] + "66",
    fill: true, tension: 0.3, borderWidth: 1, pointRadius: 0,
  }));
}

function smallScreen() { return window.innerWidth <= 640; }

function chartTitle() {
  if (state.viewMode === "share") {
    return smallScreen() ? "主题构成占比" : "卫生健康主题政策构成占比逐年变化（AI 标签）";
  }
  return smallScreen()
    ? "主题政策逐年变化（AI 标签）"
    : "卫生健康主题政策数量逐年变化（AI 主题标签）";
}

function drawChart() {
  state.chart = new Chart($("#chart").getContext("2d"), {
    type: "line",
    data: { labels: state.trends.years, datasets: buildDatasets() },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: {
          boxWidth: smallScreen() ? 10 : 14,
          padding: smallScreen() ? 6 : 10,
          font: { size: smallScreen() ? 11 : 12 } } },
        title: { display: true, text: chartTitle() },
      },
      scales: {
        y: {
          beginAtZero: true,
          stacked: state.viewMode === "share",
          max: state.viewMode === "share" ? 100 : undefined,
          title: { display: true, text: state.viewMode === "share" ? "主题构成占比（%）" : "政策数（篇）" },
        },
        x: { stacked: state.viewMode === "share" },
      },
    },
  });
}

function refreshChart() {
  if (!state.chart) { drawChart(); return; }
  state.chart.data.datasets = buildDatasets();
  state.chart.options.plugins.title.text = chartTitle();
  state.chart.update();
  renderForecast();
}

// 视图切换（数量↔占比）要改 scales(stacked)，用重建最稳
function rebuildChart() {
  if (state.chart) { state.chart.destroy(); state.chart = null; }
  drawChart();
  renderForecast();
}

function renderThemeList(theme) {
  const hits = state.policies.filter((p) => (p.th || []).includes(theme));
  hits.sort((a, b) => b.d.localeCompare(a.d));
  const desc = state.trends.themes[theme] && state.trends.themes[theme].desc || "";
  $("#theme-count").textContent =
    `「${theme}」共 ${hits.length} 篇（AI 主题标签）。${desc}`;
  $("#theme-list").innerHTML = hits.slice(0, 50).map((p) => itemHTML(p, "")).join("") ||
    `<li class="item muted">该主题暂无打标政策（可能还在打标中）。</li>`;
  renderForecast(theme, hits, desc);
}

function renderForecast(theme = $("#theme-pick")?.value, hits = null, desc = "") {
  const box = $("#forecast-box");
  if (!box || !theme) return;
  const matched = hits || state.policies.filter((p) => (p.th || []).includes(theme));
  const byYear = {};
  matched.forEach((p) => { byYear[p.y] = (byYear[p.y] || 0) + 1; });
  const activeYears = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  const latest = activeYears[activeYears.length - 1] || "-";
  const recentFloor = Math.max(...state.trends.years) - 2;
  const recent = matched.filter((p) => p.y >= recentFloor).length;
  const rule = FORECAST_RULES.find((item) =>
    item.keys.some((key) => theme.includes(key) || desc.includes(key)));
  const cards = rule ? rule.items : [
    ["政策延续", recent ? "近三年仍有政策命中，说明该主题仍处在持续推进或制度完善阶段。" : "近三年命中较少，后续可重点观察是否出现新的专项文件或评价指标。"],
    ["协同重点", "建议结合发布机关、主题标签和年度峰值，识别跨部门协同和治理工具变化。"],
    ["研究提示", "后续可补充政策目标、工具、约束条件和实施评价，形成专题演进报告。"]
  ];
  const evidence = matched.length >= 100 ? "高" : matched.length >= 30 ? "中" : matched.length > 0 ? "低" : "-";
  box.innerHTML = `
    <div class="forecast-head">
      <div>
        <span>未来方向研判</span>
        <h3>${esc(theme)}：${esc(rule?.title || "后续观察重点")}</h3>
      </div>
      <dl>
        <div><dt>证据强度</dt><dd>${evidence}</dd></div>
        <div><dt>近三年命中</dt><dd>${recent}篇</dd></div>
        <div><dt>最近年份</dt><dd>${latest}</dd></div>
      </dl>
    </div>
    <div class="forecast-cards">
      ${cards.map(([title, text]) => `<article><strong>${esc(title)}</strong><p>${esc(text)}</p></article>`).join("")}
    </div>`;
}

/* ---------- About ---------- */
function initAbout() {
  const m = state.meta;
  const aboutStats = $("#about-stats");
  const footMeta = $("#foot-meta");
  if (aboutStats) {
      aboutStats.textContent =
    `收录政策 ${m.total} 篇，年份覆盖 ${m.year_range[0]}–${m.year_range[1]}，最新政策日期 ${latestPolicyDate()}，最近检查于 ${lastCheckedAt(m)}。`;
  }
  if (footMeta) {
    footMeta.innerHTML = [
      `<span>卫生健康政策库 · 政策文件 ${esc(String(m.policy_total || m.total))} 篇 · 关联解读 ${esc(String(m.interpretation_total || 0))} 篇</span>`,
      `<span>数据来源：中国政府网政策文件库</span>`,
      `<span>最新政策日期：${esc(latestPolicyDate())}</span>`,
      `<span>最近检查：${esc(lastCheckedAt(m))}</span>`,
    ].join("");
  }
}

boot();
