/* 卫生健康政策库 —— 纯前端逻辑：加载 JSON、检索筛选、分页、趋势图 */
"use strict";

const PAGE = 20;
const state = {
  policies: [], interpretations: [], excluded: [], trends: null, meta: null,
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

async function boot() {
  try {
    const [pol, tr, meta] = await Promise.all([
      loadJSON("data/policies.json"),
      loadJSON("data/trends.json"),
      loadJSON("data/meta.json"),
    ]);
    const prepared = preparePolicyCorpus(pol);
    state.interpretations = prepared.interpretations;
    state.excluded = prepared.excluded;
    state.policies = prepared.policies.map((p) => ({
      ...p,
      tx: p.txv || window.POLICY_TAXONOMY?.classify(p) || null
    }));
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
  const byNormTitle = new Map();
  policies.forEach((p) => {
    const docNo = docNoFromText(`${p.pc || ""} ${p.t || ""} ${p.s || ""}`);
    if (docNo) byDocNo.set(docNo, p);
    const norm = normalizePolicyTitle(p.t);
    if (norm) byNormTitle.set(norm, p);
    p.interps = [];
  });
  interpretations.forEach((item) => {
    const text = `${item.t || ""} ${item.s || ""}`;
    const docNo = docNoFromText(text);
    let target = docNo ? byDocNo.get(docNo) : null;
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
  return items;
}

function clearBrowseFilter(key) {
  if (key === "all") {
    ["#q", "#f-year", "#f-theme", "#f-ministry", "#f-bureau", "#f-office", "#f-route", "#f-doc-state"].forEach((selector) => {
      $(selector).value = "";
    });
    $("#f-sort").value = "date_desc";
  } else if (key === "q") {
    $("#q").value = "";
  } else if (key === "year") {
    $("#f-year").value = "";
  } else if (key === "theme") {
    $("#f-theme").value = "";
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

function renderMinistryOptions() {
  const tx = window.POLICY_TAXONOMY;
  const sel = $("#f-ministry");
  const current = sel.value;
  const counts = countBy(state.policies, (p) => p.tx?.ministryIds || []);
  sel.innerHTML = `<option value="">全部部委</option>` + tx.ministries
    .filter((item) => counts.get(item.id))
    .map((item) => `<option value="${esc(item.id)}">${esc(item.name)}（${counts.get(item.id)}）</option>`)
    .join("");
  sel.value = [...sel.options].some((option) => option.value === current) ? current : "";
}

function renderBureauOptions() {
  const tx = window.POLICY_TAXONOMY;
  const ministryId = $("#f-ministry").value;
  const sel = $("#f-bureau");
  const current = sel.value;
  const pool = state.policies.filter((p) => !ministryId || (p.tx?.ministryIds || []).includes(ministryId));
  const counts = countBy(pool, (p) => p.tx?.bureauId);
  const candidates = tx.bureausFor(ministryId).filter((item) => counts.get(item.id));
  sel.innerHTML = `<option value="">全部司局</option>` + candidates
    .map((item) => `<option value="${esc(item.id)}">${esc(item.name)}（${counts.get(item.id)}）</option>`)
    .join("");
  sel.value = [...sel.options].some((option) => option.value === current) ? current : "";
}

function renderOfficeOptions() {
  const tx = window.POLICY_TAXONOMY;
  const ministryId = $("#f-ministry").value;
  const bureauId = $("#f-bureau").value;
  const sel = $("#f-office");
  const current = sel.value;
  const pool = state.policies.filter((p) => {
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
}

function applyFilters() {
  const q = $("#q").value.trim().toLowerCase();
  const y = $("#f-year").value;
  const th = $("#f-theme").value;
  const ministry = $("#f-ministry").value, bureau = $("#f-bureau").value, office = $("#f-office").value;
  const route = $("#f-route").value, docState = $("#f-doc-state").value;
  const sort = $("#f-sort").value;
  let arr = state.policies.filter((p) => {
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
  ).join("");
  $("#quality-details")?.classList.remove("hidden");
}

function taxonomyText(p) {
  if (!p.tx) return "";
  return `${p.tx.ministryName} ${p.tx.bureauName} ${p.tx.office} ${p.tx.assignment} ${p.tx.evidence || ""}`;
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

function itemHTML(p, q) {
  const docNo = p.pcv || p.pc || "";
  const issuer = p.ogv || p.og || "";
  const title = displayTitle(p, docNo, issuer);
  const themes = (p.th || []).map((t) => `<span class="th-chip">${esc(t)}</span>`).join("");
  const route = p.tx ? [p.tx.ministryName, p.tx.bureauName, p.tx.office].filter(Boolean).join(" / ") : "";
  const taxonomy = p.tx
    ? `<div class="policy-route"><span>归口</span><strong>${esc(route)}</strong><em>${esc(p.tx.assignment)}</em></div>`
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
    ${themes ? `<div class="th-row">${themes}</div>` : ""}
    ${summary ? `<p class="summary">${highlight(summary, q)}</p>` : ""}
    ${interps ? `<div class="interp-row"><span>政策解读</span>${interps}</div>` : ""}
  </li>`;
}

function hasActiveBrowseFilter(q) {
  return q || ["#f-year", "#f-theme", "#f-ministry", "#f-bureau", "#f-office", "#f-route", "#f-doc-state"]
    .some((s) => $(s).value);
}

function renderActiveFilters(q) {
  const box = $("#active-filters");
  const items = activeFilterItems(q);
  const advancedCount = items.filter(([key]) => ["ministry", "bureau", "office", "route", "doc-state"].includes(key)).length;
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
  $("#result-info").textContent = `共 ${total} 篇` + (hasActiveBrowseFilter(q) ? "（已筛选）" : "");
  $("#list").innerHTML = slice.map((p) => itemHTML(p, q)).join("") ||
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
  "#65a30d", "#b45309", "#db2777", "#4f46e5", "#0d9488", "#9333ea"];

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
  if (words.some((w) => p.t.includes(w))) return "strong";
  if (mode === "all" && words.some((w) => p.s.includes(w))) return "weak";
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

function smallScreen() { return window.innerWidth <= 640; }

function chartTitle() {
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
      scales: { y: { beginAtZero: true, title: { display: true, text: "政策数（篇）" } } },
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
