/* 卫生健康政策库 —— 纯前端逻辑：加载 JSON、检索筛选、分页、趋势图 */
"use strict";

const PAGE = 20;
const state = {
  policies: [], trends: null, meta: null,
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
    state.policies = pol; state.trends = tr; state.meta = meta;
    $("#loading").classList.add("hidden");
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

/* ---------- Tabs ---------- */
function initTabs() {
  document.querySelectorAll(".tab").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const v = b.dataset.view;
      ["browse", "trend", "about"].forEach((name) =>
        $("#view-" + name).classList.toggle("hidden", name !== v));
      if (v === "trend" && !state.chart) drawChart();
    });
  });
}

/* ---------- Filters ---------- */
function initFilters() {
  const m = state.meta;
  const yearSel = $("#f-year");
  Object.keys(m.year_count).sort().reverse().forEach((y) => {
    yearSel.insertAdjacentHTML("beforeend", `<option value="${y}">${y}（${m.year_count[y]}）</option>`);
  });
  const catSel = $("#f-cat");
  Object.keys(m.cat_count).forEach((c) => {
    catSel.insertAdjacentHTML("beforeend",
      `<option value="${c}">${m.cat_label[c] || c}（${m.cat_count[c]}）</option>`);
  });
  const orgSel = $("#f-org");
  m.top_orgs.forEach(([org, n]) => {
    orgSel.insertAdjacentHTML("beforeend", `<option value="${esc(org)}">${esc(org)}（${n}）</option>`);
  });
}

function initBrowse() {
  let timer;
  $("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(applyFilters, 200); });
  ["#f-year", "#f-cat", "#f-org", "#f-sort"].forEach((s) =>
    $(s).addEventListener("change", applyFilters));
}

function applyFilters() {
  const q = $("#q").value.trim().toLowerCase();
  const y = $("#f-year").value, c = $("#f-cat").value, o = $("#f-org").value;
  const sort = $("#f-sort").value;
  let arr = state.policies.filter((p) => {
    if (y && String(p.y) !== y) return false;
    if (c && p.c !== c) return false;
    if (o && p.ogk !== o) return false;
    if (q) {
      const hay = (p.t + " " + p.pc + " " + p.s + " " + p.og).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  arr.sort((a, b) => sort === "date_asc" ? a.d.localeCompare(b.d) : b.d.localeCompare(a.d));
  state.filtered = arr;
  state.page = 1;
  renderList();
}

function highlight(text, q) {
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + q.length)) +
    "</mark>" + esc(text.slice(i + q.length));
}

function itemHTML(p, q, badge) {
  const cat = state.meta.cat_label[p.c] || p.c;
  const badgeHtml = badge ? `<span class="chip rel-${badge.cls}">${badge.text}</span>` : "";
  const meta = [
    `<span class="chip">${esc(cat)}</span>`,
    p.d ? `<span>${esc(p.d)}</span>` : "",
    p.pc ? `<span>${esc(p.pc)}</span>` : "",
    p.og ? `<span>${esc(p.og)}</span>` : "",
  ].filter(Boolean).join("");
  return `<li class="item">
    <h3><a href="${esc(p.u)}" target="_blank" rel="noopener">${highlight(p.t, q)}</a></h3>
    <div class="meta">${badgeHtml}${meta}</div>
    ${p.s ? `<p class="summary">${highlight(p.s, q)}…</p>` : ""}
  </li>`;
}

function renderList() {
  const q = $("#q").value.trim().toLowerCase();
  const total = state.filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE;
  const slice = state.filtered.slice(start, start + PAGE);
  $("#result-info").textContent = `共 ${total} 篇` + (q || $("#f-year").value || $("#f-cat").value || $("#f-org").value ? "（已筛选）" : "");
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
    data: state.relMode === "strong" ? d.series_strong : d.series_all,
    borderColor: PALETTE[i % PALETTE.length],
    backgroundColor: PALETTE[i % PALETTE.length],
    tension: 0.3, borderWidth: 2, pointRadius: 2,
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

function chartTitle() {
  return state.relMode === "strong"
    ? "卫生健康主题政策数量逐年变化（仅标题强相关）"
    : "卫生健康主题政策数量逐年变化（标题+摘要）";
}

function drawChart() {
  state.chart = new Chart($("#chart").getContext("2d"), {
    type: "line",
    data: { labels: state.trends.years, datasets: buildDatasets() },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 14, font: { size: 12 } } },
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
}

function renderThemeList(theme) {
  const words = state.trends.themes[theme].words;
  const mode = state.relMode;
  const hits = [];
  for (const p of state.policies) {
    const h = hitMode(p, words, mode);
    if (h) hits.push({ p, h });
  }
  hits.sort((a, b) => b.p.d.localeCompare(a.p.d));
  const modeLabel = mode === "strong" ? "仅标题强相关" : "标题+摘要";
  $("#theme-count").textContent =
    `「${theme}」命中 ${hits.length} 篇（${modeLabel}；关键词：${words.join("、")}），列出最近 50 篇`;
  $("#theme-list").innerHTML = hits.slice(0, 50).map(({ p, h }) =>
    itemHTML(p, "", h === "strong"
      ? { cls: "strong", text: "标题强相关" }
      : { cls: "weak", text: "摘要弱相关" })).join("");
}

/* ---------- About ---------- */
function initAbout() {
  const m = state.meta;
  $("#about-stats").textContent =
    `收录政策 ${m.total} 篇，年份覆盖 ${m.year_range[0]}–${m.year_range[1]}，数据构建于 ${m.built_at}。`;
  $("#foot-meta").textContent =
    `卫生健康政策库 · 共 ${m.total} 篇 · 更新于 ${m.built_at} · 数据来源：中国政府网政策文件库`;
}

boot();
