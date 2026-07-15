# -*- coding: utf-8 -*-
"""Policy metadata enrichment for the static site.

The gov.cn policy-library records are authoritative, but many gongbao records
leave pcode/puborg empty while keeping the document number and issuer in the
title or summary. This module extracts those fields and assigns a transparent
ministry/bureau/office routing that can be displayed and filtered.
"""
from __future__ import annotations

import re
from typing import Any


MINISTRIES = {
    "state": "国务院及办公厅",
    "nhc": "国家卫生健康委",
    "nhsa": "国家医保局",
    "cdc": "国家疾控局",
    "tcm": "国家中医药局",
    "nmpa": "国家药监局",
    "ndrc": "国家发展改革委",
    "mof": "财政部",
    "mohrss": "人力资源社会保障部",
    "mca": "民政部",
    "moe": "教育部",
    "samr": "市场监管总局",
    "other": "其他协同部门",
}

BUREAUS = {
    "state_health_reform": ("state", "医改与健康中国综合政策"),
    "nhc_office": ("nhc", "办公厅"),
    "nhc_hr": ("nhc", "人事司"),
    "nhc_planning": ("nhc", "规划发展与信息化司"),
    "nhc_finance": ("nhc", "财务司"),
    "nhc_legal": ("nhc", "法规司"),
    "nhc_reform": ("nhc", "体制改革司"),
    "nhc_medical": ("nhc", "医政司"),
    "nhc_primary": ("nhc", "基层卫生健康司"),
    "nhc_emergency": ("nhc", "医疗应急司"),
    "nhc_science": ("nhc", "科技教育司"),
    "nhc_drug": ("nhc", "药物政策司"),
    "nhc_food": ("nhc", "食品安全标准司"),
    "nhc_ageing": ("nhc", "老龄健康司"),
    "nhc_maternal": ("nhc", "妇幼健康司"),
    "nhc_occupational": ("nhc", "职业健康司"),
    "nhc_population": ("nhc", "人口家庭司"),
    "nhc_publicity": ("nhc", "宣传司"),
    "nhc_international": ("nhc", "国际合作司"),
    "nhsa_benefits": ("nhsa", "待遇保障司"),
    "nhsa_services": ("nhsa", "医药服务管理司"),
    "nhsa_price": ("nhsa", "医药价格和招标采购司"),
    "nhsa_fund": ("nhsa", "基金监管司"),
    "nhsa_planning": ("nhsa", "规划财务法规司"),
    "cdc_monitoring": ("cdc", "监测预警司"),
    "cdc_emergency": ("cdc", "应急处置司"),
    "cdc_immunization": ("cdc", "卫生与免疫规划司"),
    "cdc_supervision": ("cdc", "综合监督司"),
    "tcm_admin": ("tcm", "医政管理与服务司"),
    "nmpa_drug": ("nmpa", "药品注册与监管相关司局"),
    "ndrc_social": ("ndrc", "社会发展司"),
    "mof_social": ("mof", "社会保障司"),
    "mohrss_social": ("mohrss", "社会保障与职业能力相关司局"),
    "mca_ageing": ("mca", "养老服务与社会救助相关司局"),
    "moe_sports_health": ("moe", "体育卫生与艺术教育司"),
    "samr_food": ("samr", "食品安全与标准相关司局"),
    "other_collab": ("other", "协同治理"),
}

FALLBACK = {
    "state": ("state_health_reform", "综合政策"),
    "nhc": ("nhc_office", "综合处"),
    "nhsa": ("nhsa_planning", "规划统计处"),
    "cdc": ("cdc_monitoring", "风险评估处"),
    "tcm": ("tcm_admin", "中医药服务处"),
    "nmpa": ("nmpa_drug", "综合监管"),
    "ndrc": ("ndrc_social", "卫生健康发展"),
    "mof": ("mof_social", "卫生健康资金"),
    "mohrss": ("mohrss_social", "社会保障综合"),
    "mca": ("mca_ageing", "养老服务"),
    "moe": ("moe_sports_health", "学校卫生"),
    "samr": ("samr_food", "食品安全协调"),
    "other": ("other_collab", "联合发文"),
}

ORG_ALIASES = [
    ("state", ["国务院办公厅", "国务院"]),
    ("nhc", ["国家卫生健康委员会", "国家卫生健康委", "卫生健康委", "国家卫健委", "卫生计生委"]),
    ("nhsa", ["国家医疗保障局", "国家医保局", "医保局", "医疗保障局"]),
    ("cdc", ["国家疾病预防控制局", "国家疾控局", "疾控局"]),
    ("tcm", ["国家中医药管理局", "国家中医药局", "中医药局"]),
    ("nmpa", ["国家药品监督管理局", "国家药监局", "药监局", "食品药品监管总局"]),
    ("ndrc", ["国家发展改革委", "国家发展和改革委员会", "发展改革委", "发改委"]),
    ("mof", ["财政部"]),
    ("mohrss", ["人力资源社会保障部", "人力资源和社会保障部", "人社部"]),
    ("mca", ["民政部"]),
    ("moe", ["教育部"]),
    ("samr", ["市场监管总局", "国家市场监督管理总局"]),
]

DOC_PREFIX_RULES = [
    ("国办发", "state", "state_health_reform", "规划部署"),
    ("国办函", "state", "state_health_reform", "综合政策"),
    ("国发", "state", "state_health_reform", "规划部署"),
    ("国卫办基层", "nhc", "nhc_primary", "综合处"),
    ("国卫基层", "nhc", "nhc_primary", "综合处"),
    ("国卫办医", "nhc", "nhc_medical", "综合处"),
    ("国卫医", "nhc", "nhc_medical", "综合处"),
    ("国卫办应急", "nhc", "nhc_emergency", "综合处"),
    ("国卫应急", "nhc", "nhc_emergency", "医疗应急管理处"),
    ("国卫办疾控", "cdc", "cdc_monitoring", "传染病监测处"),
    ("国卫疾控", "cdc", "cdc_monitoring", "传染病监测处"),
    ("国卫办规划", "nhc", "nhc_planning", "综合处"),
    ("国卫规划", "nhc", "nhc_planning", "发展规划处"),
    ("国卫财务函", "nhc", "nhc_finance", "预算管理处"),
    ("国卫办财务", "nhc", "nhc_finance", "综合处"),
    ("国卫财务", "nhc", "nhc_finance", "预算管理处"),
    ("国卫办法规", "nhc", "nhc_legal", "综合处"),
    ("国卫法规", "nhc", "nhc_legal", "立法处"),
    ("国卫体改", "nhc", "nhc_reform", "综合协调处"),
    ("国卫办科教", "nhc", "nhc_science", "综合处"),
    ("国卫科教", "nhc", "nhc_science", "医学教育处"),
    ("国卫办药政", "nhc", "nhc_drug", "综合处"),
    ("国卫药政", "nhc", "nhc_drug", "药物政策处"),
    ("国卫办食品", "nhc", "nhc_food", "综合处"),
    ("国卫食品", "nhc", "nhc_food", "食品安全标准管理处"),
    ("国卫老龄", "nhc", "nhc_ageing", "健康服务处"),
    ("国卫办老龄", "nhc", "nhc_ageing", "综合处"),
    ("国卫妇幼", "nhc", "nhc_maternal", "妇女卫生处"),
    ("国卫办妇幼", "nhc", "nhc_maternal", "综合处"),
    ("国卫职健", "nhc", "nhc_occupational", "职业病管理处"),
    ("国卫办职健", "nhc", "nhc_occupational", "综合处"),
    ("国卫人口", "nhc", "nhc_population", "政策协调处"),
    ("国卫宣传", "nhc", "nhc_publicity", "宣传处"),
    ("国中医药医政", "tcm", "tcm_admin", "中医医院管理处"),
    ("国中医药人教", "tcm", "tcm_admin", "传承创新处"),
    ("国中医药科技", "tcm", "tcm_admin", "传承创新处"),
    ("国中医药综合", "tcm", "tcm_admin", "中医药服务处"),
    ("国疾控传防", "cdc", "cdc_monitoring", "传染病监测处"),
    ("国疾控监测", "cdc", "cdc_monitoring", "监测预警处"),
    ("国疾控综监督", "cdc", "cdc_supervision", "监督执法处"),
    ("国疾控应急", "cdc", "cdc_emergency", "应急处置处"),
    ("国疾控卫免", "cdc", "cdc_immunization", "免疫规划处"),
    ("国疾控综卫免", "cdc", "cdc_immunization", "免疫规划处"),
    ("国疾控综", "cdc", "cdc_monitoring", "风险评估处"),
    ("医保发", "nhsa", "nhsa_planning", "规划统计处"),
    ("医保办发", "nhsa", "nhsa_planning", "规划统计处"),
    ("医保办函", "nhsa", "nhsa_planning", "法规标准处"),
    ("医保函", "nhsa", "nhsa_planning", "法规标准处"),
    ("药监综", "nmpa", "nmpa_drug", "综合监管"),
    ("国药监", "nmpa", "nmpa_drug", "药品监管"),
    ("食药监", "nmpa", "nmpa_drug", "药品监管"),
    ("发改社会", "ndrc", "ndrc_social", "卫生健康发展"),
    ("财社", "mof", "mof_social", "卫生健康资金"),
    ("人社部发", "mohrss", "mohrss_social", "社会保障综合"),
    ("民发", "mca", "mca_ageing", "养老服务"),
    ("教体艺", "moe", "moe_sports_health", "学校卫生"),
]

REFINERS = [
    ("state_health_reform", "综合政策", r"医药卫生体制改革|深化医改|三医协同|健康中国|国民健康"),
    ("nhc_medical", "医疗资源处", r"区域医疗中心|国家医学中心|医疗资源|床位|资源扩容"),
    ("nhc_medical", "护理与康复处", r"护理|康复|安宁疗护"),
    ("nhc_medical", "心理健康与精神卫生处", r"精神卫生|心理健康|精神障碍"),
    ("nhc_medical", "医疗管理处", r"医疗质量|医疗安全|质控|诊疗规范|检查检验结果互认|合理医疗检查"),
    ("nhc_primary", "运行评价处", r"医共体|医疗卫生共同体|县域|基层运行|乡村医生|村卫生室|社区卫生服务"),
    ("nhc_primary", "家庭医生处", r"家庭医生|签约服务|家庭病床"),
    ("nhc_primary", "基本公共卫生处", r"基本公共卫生|慢病|健康档案|老年人健康管理"),
    ("nhc_planning", "信息统计处", r"信息化|互联网|数据|平台|统计|远程医疗|智慧医院"),
    ("nhc_planning", "信息统计处", r"人工智能\+?医疗卫生|医疗人工智能|健康医疗大数据|互联互通|数字健康"),
    ("nhc_planning", "爱国卫生工作办公室", r"爱国卫生|健康城市|健康乡村|控烟"),
    ("nhc_planning", "发展规划处", r"规划|纲要|实施方案|健康中国|体系建设|资源配置|十四五|十五五"),
    ("nhc_finance", "建设装备处", r"医用设备|大型医用设备|设备集中采购|医疗设备|装备|采购"),
    ("nhc_finance", "经济管理处", r"经济管理|成本|运营管理|财务管理|预算绩效"),
    ("nhc_finance", "预算管理处", r"预算|补助资金|转移支付|财政事权|卫生健康资金"),
    ("nhc_ageing", "医养结合处", r"医养结合|养老|失能"),
    ("nhc_maternal", "儿童卫生处", r"儿童|婴幼儿|托育"),
    ("nhc_maternal", "出生缺陷防治处", r"出生缺陷|产前筛查|辅助生殖"),
    ("nhc_population", "家庭发展指导处", r"托育|婴幼儿照护|家庭发展|计划生育特殊家庭"),
    ("nhc_population", "政策协调处", r"生育支持|优化生育|三孩|人口长期均衡"),
    ("nhc_occupational", "职业病管理处", r"职业病|尘肺|职业病诊断|职业病防治"),
    ("nhc_occupational", "技术服务管理处", r"职业卫生技术服务|职业健康检查|放射卫生"),
    ("nhc_drug", "药品目录管理处", r"基本药物目录|罕见病目录|药品目录"),
    ("nhc_drug", "药品供应保障协调处", r"短缺药|药品供应|药品保障"),
    ("nhc_drug", "药物政策处", r"合理用药|处方|药物政策|基本药物"),
    ("nhsa_services", "医保目录处", r"医保目录|药品目录|谈判药品|限定支付|商保创新药目录"),
    ("nhsa_services", "支付方式改革处", r"DRG|DIP|支付方式|付费|总额预算"),
    ("nhsa_services", "定点协议管理处", r"定点医药机构|定点医疗机构|协议管理"),
    ("nhsa_services", "异地就医结算处", r"异地就医|跨省直接结算|联网结算"),
    ("nhsa_price", "药品耗材招采处", r"集采|集中带量采购|药品采购|耗材|招标采购"),
    ("nhsa_price", "医疗服务价格处", r"医疗服务价格|价格项目|收费标准|价格治理"),
    ("nhsa_fund", "基金监管处", r"基金监管|欺诈骗保|医保基金|监督检查"),
    ("nhsa_fund", "飞行检查处", r"飞行检查"),
    ("nhsa_benefits", "长期护理保险处", r"长期护理|长护险"),
    ("nhsa_benefits", "生育保障处", r"生育保险|生育保障|生育津贴"),
    ("nhsa_benefits", "医疗救助处", r"医疗救助|困难群众|低收入"),
    ("cdc_monitoring", "传染病监测处", r"传染病监测|疫情监测|法定传染病"),
    ("cdc_monitoring", "预警处", r"预警"),
    ("cdc_immunization", "免疫规划处", r"免疫规划|疫苗|接种"),
    ("cdc_immunization", "学校卫生处", r"学校卫生|学生健康|近视"),
    ("cdc_emergency", "应急处置处", r"疾控应急|疫情处置|突发急性传染病|应急处置"),
    ("tcm_admin", "中医医院管理处", r"中医医院|中西医协同|中医医疗机构"),
    ("tcm_admin", "中药管理处", r"中药|中药饮片|中成药"),
    ("nmpa_drug", "医疗器械监管", r"医疗器械|体外诊断|器械"),
    ("nmpa_drug", "药品监管", r"药品监管|药品安全|药品注册|药品经营|医药代表"),
    ("ndrc_social", "重大项目", r"区域医疗中心|国家医学中心|重大项目|基础设施"),
    ("mof_social", "公共卫生投入", r"财政补助|转移支付|公共卫生资金|补助资金"),
    ("mohrss_social", "工伤保险", r"工伤|工伤保险|工伤预防"),
    ("mca_ageing", "养老服务", r"养老服务|养老机构|老年人福利|医养结合"),
    ("moe_sports_health", "学校卫生", r"学校卫生|学生健康|近视|儿童青少年"),
    ("samr_food", "食品安全协调", r"食品安全|市场监管|食品生产|特殊食品"),
]

DOCNO_RE = re.compile(r"([\u4e00-\u9fa5A-Za-z]{1,16}〔\d{4}〕\d+号)")
SPACES_RE = re.compile(r"[\s\u3000\u2002\u00a0]+")


def _clean(text: Any) -> str:
    text = SPACES_RE.sub(" ", str(text or "")).strip()
    return text.replace("市 场", "市场").replace("卫 生", "卫生")


def _doc_no(policy: dict[str, Any]) -> tuple[str, str]:
    pc = _clean(policy.get("pc"))
    if DOCNO_RE.fullmatch(pc):
        return pc, "official_field"
    for key in ("pc", "s", "t"):
        match = DOCNO_RE.search(_clean(policy.get(key)))
        if match:
            source = "official_field" if key == "pc" else f"{key}_extracted"
            return match.group(1), source
    return "", ""


def _doc_prefix(doc_no: str) -> str:
    return doc_no.split("〔", 1)[0] if "〔" in doc_no else ""


def _split_orgs(text: str) -> list[str]:
    text = _clean(text)
    if not text:
        return []
    text = re.sub(r"(关于|令（|公告（|公告|通知|意见|印发).*$", "", text)
    parts = re.split(r"[、,，；;]\s*|\s{1,}", text)
    out: list[str] = []
    buf = ""
    for part in parts:
        part = part.strip(" ：:　《》“”\"'")
        if not part:
            continue
        if part in {"中华人民共和国", "国家"}:
            buf = part
            continue
        if buf:
            part = buf + part
            buf = ""
        if part in {"近日", "新华社北京电"} or part.startswith(("新华社记者", "记者")):
            continue
        if 2 <= len(part) <= 24 and not re.search(r"〔\d{4}〕|\d{4}年|第\d+号", part):
            out.append(part)
    return out[:12]


def _orgs_from_text(policy: dict[str, Any]) -> tuple[list[str], str]:
    official = _split_orgs(_clean(policy.get("og")))
    if official:
        return official, "official_field"
    title = _clean(policy.get("t"))
    summary = _clean(policy.get("s"))
    title_orgs = _split_orgs(title)
    if title_orgs:
        return title_orgs, "title_extracted"
    summary_prefix = summary[:220]
    summary_orgs = _split_orgs(summary_prefix)
    if summary_orgs and any(_ministry_for_org(org) for org in summary_orgs):
        return summary_orgs, "summary_extracted"
    return [], ""


def _ministry_for_org(org: str) -> str:
    for mid, aliases in ORG_ALIASES:
        if any(alias in org for alias in aliases):
            return mid
    return ""


def _detect_ministries(text: str, orgs: list[str]) -> list[str]:
    found = [_ministry_for_org(org) for org in orgs]
    found = [mid for mid in found if mid]
    if orgs and not _ministry_for_org(orgs[0]):
        found.insert(0, "other")
    hay = text
    for mid, aliases in ORG_ALIASES:
        if any(alias in hay for alias in aliases) and mid not in found:
            found.append(mid)
    return list(dict.fromkeys(found))


def _match_prefix(prefix: str) -> tuple[str, str, str, str] | None:
    for rule_prefix, ministry_id, bureau_id, office in DOC_PREFIX_RULES:
        if prefix.startswith(rule_prefix):
            return rule_prefix, ministry_id, bureau_id, office
    return None


def _refine_office(bureau_id: str, ministry_id: str, text: str) -> tuple[str, str] | None:
    for candidate_bureau, office, pattern in REFINERS:
        candidate_ministry = BUREAUS[candidate_bureau][0]
        if (candidate_bureau == bureau_id or candidate_ministry == ministry_id) and re.search(pattern, text, re.I):
            return candidate_bureau, office
    return None


def _route(policy: dict[str, Any], doc_no: str, doc_source: str, orgs: list[str], org_source: str) -> dict[str, Any]:
    text = " ".join(_clean(policy.get(k)) for k in ("t", "pc", "og", "s"))
    ministry_ids = _detect_ministries(text, orgs)
    prefix = _doc_prefix(doc_no)
    prefix_rule = _match_prefix(prefix)
    evidence: list[str] = []

    if prefix_rule:
        rule_prefix, ministry_id, bureau_id, office = prefix_rule
        refined = _refine_office(bureau_id, ministry_id, text)
        if refined:
            bureau_id, office = refined
            evidence.append(f"主题词细分：{office}")
        evidence.insert(0, f"文号前缀：{rule_prefix}")
        confidence = 0.95 if doc_source == "official_field" else 0.88
        assignment = "文号归口"
    else:
        primary = ministry_ids[0] if ministry_ids else "other"
        bureau_id, office = FALLBACK.get(primary, FALLBACK["other"])
        refined = _refine_office(bureau_id, primary, text)
        if refined:
            bureau_id, office = refined
        ministry_id = BUREAUS.get(bureau_id, ("other", ""))[0]
        evidence.append("发文机关识别" if ministry_ids else "主题词归口")
        if refined:
            evidence.append(f"主题词细分：{office}")
        confidence = 0.78 if ministry_ids else 0.58
        assignment = "机关归口" if ministry_ids else "主题归口"

    if ministry_id not in ministry_ids:
        ministry_ids = [ministry_id, *ministry_ids]
    ministry_ids = list(dict.fromkeys(ministry_ids))
    bureau_ministry, bureau_name = BUREAUS.get(bureau_id, BUREAUS["other_collab"])
    ministry_id = bureau_ministry if bureau_ministry != "other" else ministry_id
    return {
        "ministryId": ministry_id,
        "ministryName": MINISTRIES.get(ministry_id, MINISTRIES["other"]),
        "ministryIds": ministry_ids,
        "bureauId": bureau_id,
        "bureauName": bureau_name,
        "office": office,
        "assignment": assignment,
        "docNo": doc_no,
        "docPrefix": prefix,
        "evidence": "；".join(evidence),
        "confidence": round(confidence, 2),
        "orgSource": org_source,
        "docSource": doc_source,
    }


def enrich_policy(policy: dict[str, Any]) -> dict[str, Any]:
    doc_no, doc_source = _doc_no(policy)
    orgs, org_source = _orgs_from_text(policy)
    primary_org = orgs[0] if orgs else _clean(policy.get("ogk")) or "未标注"
    policy["pcv"] = doc_no
    policy["pcs"] = doc_source
    policy["ogv"] = "、".join(orgs)
    policy["ogs"] = org_source
    policy["ogvk"] = primary_org
    policy["txv"] = _route(policy, doc_no, doc_source, orgs, org_source)
    return policy


def enrich_policies(policies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [enrich_policy(p) for p in policies]
