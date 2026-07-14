import fs from "node:fs";

const DATA_DIR = "site/data";
const policyPath = `${DATA_DIR}/policies.json`;
const metaPath = `${DATA_DIR}/meta.json`;
const trendsPath = `${DATA_DIR}/trends.json`;

const policies = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const oldMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
const oldTrends = JSON.parse(fs.readFileSync(trendsPath, "utf8"));

const manualPolicies = [
  {
    id: "manual-20260707-national-health-15th-plan",
    t: "国务院关于印发《国民健康“十五五”规划》的通知",
    pc: "国发〔2026〕23号",
    og: "国务院",
    ogk: "国务院",
    c: "gongwen",
    d: "2026-07-07",
    y: 2026,
    s: "国务院关于印发《国民健康“十五五”规划》的通知，国发〔2026〕23号。规划围绕优化全人群全方位全周期健康服务、筑牢卫生健康安全屏障、完善优质高效整合型医疗卫生服务体系、培育卫生健康高质量发展新动能、推进以健康为中心的高效能治理等部署未来五年国民健康工作。",
    u: "https://sousuo.www.gov.cn/zcwjk/policyDocumentLibrary?t=zhengcelibrary_gw",
    th: ["医改综合", "健康促进与教育", "公共卫生服务", "分级诊疗与基层", "互联网+医疗与数字健康"],
    pcv: "国发〔2026〕23号",
    pcs: "official_field",
    ogv: "国务院",
    ogs: "official_field",
    ogvk: "国务院",
    txv: {
      ministryId: "state",
      ministryName: "国务院及办公厅",
      ministryIds: ["state", "nhc", "nhsa", "cdc", "tcm", "ndrc", "mof"],
      bureauId: "state_health_reform",
      bureauName: "医改与健康中国综合政策",
      office: "综合政策",
      assignment: "文号归口",
      docNo: "国发〔2026〕23号",
      docPrefix: "国发",
      evidence: "文号前缀：国发；人工核验：国务院文件；主题关联：国民健康规划、健康中国、十五五",
      confidence: 0.95,
      orgSource: "official_field",
      docSource: "official_field",
    },
  },
];

const manualIds = new Set(manualPolicies.map((p) => p.id));
const manualDocNos = new Set(manualPolicies.map((p) => p.pc).filter(Boolean));
const manualTitles = new Set(manualPolicies.map((p) => p.t));
const replacedTagged = policies.filter(
  (p) =>
    (manualIds.has(p.id) || manualDocNos.has(p.pc) || manualTitles.has(p.t)) &&
    (p.th || []).length,
).length;
const addedTagged = manualPolicies.filter((p) => (p.th || []).length).length;
const merged = policies.filter(
  (p) => !manualIds.has(p.id) && !manualDocNos.has(p.pc) && !manualTitles.has(p.t),
);
merged.push(...manualPolicies);
merged.sort(
  (a, b) =>
    String(b.d || "").localeCompare(String(a.d || "")) ||
    String(b.id || "").localeCompare(String(a.id || "")),
);

const yearCount = {};
const catCount = {};
const orgCount = {};
const themeCount = {};
for (const p of merged) {
  yearCount[p.y] = (yearCount[p.y] || 0) + 1;
  catCount[p.c] = (catCount[p.c] || 0) + 1;
  const org = p.ogvk || p.ogk || "未标注";
  orgCount[org] = (orgCount[org] || 0) + 1;
  for (const th of p.th || []) themeCount[th] = (themeCount[th] || 0) + 1;
}

const years = Object.keys(yearCount)
  .map(Number)
  .sort((a, b) => a - b);
const themeNames = Array.from(
  new Set([...Object.keys(oldTrends.themes || {}), ...Object.keys(themeCount)]),
).sort((a, b) => (themeCount[b] || 0) - (themeCount[a] || 0) || a.localeCompare(b, "zh-Hans-CN"));
const nextTrends = { years, themes: {} };
for (const name of themeNames) {
  const byYear = Object.fromEntries(years.map((y) => [y, 0]));
  for (const p of merged) {
    if ((p.th || []).includes(name)) byYear[p.y] = (byYear[p.y] || 0) + 1;
  }
  const series = years.map((y) => byYear[y] || 0);
  nextTrends.themes[name] = {
    desc: oldTrends.themes[name]?.desc || "",
    series,
    total: series.reduce((sum, n) => sum + n, 0),
  };
}

const builtAt = new Date().toISOString().slice(0, 19);
const nextMeta = {
  ...oldMeta,
  built_at: builtAt,
  checked_at: builtAt,
  total: merged.length,
  tagged: (oldMeta.tagged || 0) + addedTagged - replacedTagged,
  year_range: years.length ? [years[0], years[years.length - 1]] : [],
  cat_count: catCount,
  year_count: Object.fromEntries(
    Object.entries(yearCount).sort((a, b) => Number(a[0]) - Number(b[0])),
  ),
  top_orgs: Object.entries(orgCount).sort((a, b) => b[1] - a[1]).slice(0, 40),
  theme_facet: Object.entries(themeCount).sort((a, b) => b[1] - a[1]),
};

fs.writeFileSync(policyPath, JSON.stringify(merged), "utf8");
fs.writeFileSync(metaPath, JSON.stringify(nextMeta), "utf8");
fs.writeFileSync(trendsPath, JSON.stringify(nextTrends), "utf8");

console.log(
  JSON.stringify(
    {
      total: merged.length,
      manual: manualPolicies.map((p) => ({ title: p.t, docNo: p.pc, date: p.d })),
    },
    null,
    2,
  ),
);
