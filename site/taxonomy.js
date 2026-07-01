/* 部委-司局-处室归口规则。只做前端派生，不改写原始政策数据。 */
(function () {
  "use strict";

  const ministries = [
    { id: "state", name: "国务院及办公厅", aliases: ["国务院", "国务院办公厅", "国办"] },
    { id: "nhc", name: "国家卫生健康委", aliases: ["国家卫生健康委", "国家卫生健康委员会", "卫生健康委", "国家卫健委", "卫生计生委"] },
    { id: "nhsa", name: "国家医保局", aliases: ["国家医疗保障局", "国家医保局", "医保局", "医疗保障局"] },
    { id: "cdc", name: "国家疾控局", aliases: ["国家疾病预防控制局", "国家疾控局", "疾控局"] },
    { id: "tcm", name: "国家中医药局", aliases: ["国家中医药管理局", "国家中医药局", "中医药局"] },
    { id: "nmpa", name: "国家药监局", aliases: ["国家药品监督管理局", "国家药监局", "药监局"] },
    { id: "ndrc", name: "国家发展改革委", aliases: ["国家发展改革委", "国家发展和改革委员会", "发展改革委", "发改委"] },
    { id: "mof", name: "财政部", aliases: ["财政部"] },
    { id: "mohrss", name: "人力资源社会保障部", aliases: ["人力资源社会保障部", "人力资源和社会保障部", "人社部"] },
    { id: "mca", name: "民政部", aliases: ["民政部"] },
    { id: "moe", name: "教育部", aliases: ["教育部"] },
    { id: "samr", name: "市场监管总局", aliases: ["市场监管总局", "国家市场监督管理总局"] },
    { id: "other", name: "其他协同部门", aliases: [] }
  ];

  const bureaus = [
    { id: "state_health_reform", ministry: "state", name: "医改与健康中国综合政策", offices: ["综合政策", "医改协调", "规划部署"] },
    { id: "nhc_office", ministry: "nhc", name: "办公厅", offices: ["秘书处", "综合处", "督查室", "政务公开处"] },
    { id: "nhc_hr", ministry: "nhc", name: "人事司", offices: ["综合处", "干部处", "专业人才管理处", "劳动工资处"] },
    { id: "nhc_planning", ministry: "nhc", name: "规划发展与信息化司", offices: ["综合处", "发展规划处", "建设装备处", "信息统计处", "爱国卫生工作办公室"] },
    { id: "nhc_finance", ministry: "nhc", name: "财务司", offices: ["办公室", "预算管理处", "资产管理处", "审计评价处", "乡村振兴处"] },
    { id: "nhc_legal", ministry: "nhc", name: "法规司", offices: ["综合处", "立法处", "法制审核处", "标准处"] },
    { id: "nhc_reform", ministry: "nhc", name: "体制改革司", offices: ["综合协调处", "政策研究处", "督导评价处", "公立医院改革处"] },
    { id: "nhc_medical", ministry: "nhc", name: "医政司", offices: ["综合处", "医疗资源处", "医疗机构处", "医疗管理处", "心理健康与精神卫生处", "护理与康复处"] },
    { id: "nhc_primary", ministry: "nhc", name: "基层卫生健康司", offices: ["综合处", "运行评价处", "家庭医生处", "基本公共卫生处"] },
    { id: "nhc_emergency", ministry: "nhc", name: "医疗应急司", offices: ["综合处", "医疗应急管理处", "医疗应急指导处", "公共卫生医疗管理处", "血液管理处", "医疗监督和行风管理处", "安全生产处"] },
    { id: "nhc_science", ministry: "nhc", name: "科技教育司", offices: ["综合处", "项目管理处", "规划评估处", "生物安全处", "医学教育处"] },
    { id: "nhc_drug", ministry: "nhc", name: "药物政策司", offices: ["综合处", "药物政策处", "药品目录管理处", "药品供应保障协调处"] },
    { id: "nhc_food", ministry: "nhc", name: "食品安全标准司", offices: ["综合处", "食品安全标准管理处", "食品安全风险监测与评估处", "食品营养处"] },
    { id: "nhc_ageing", ministry: "nhc", name: "老龄健康司", offices: ["综合处", "健康服务处", "医养结合处"] },
    { id: "nhc_maternal", ministry: "nhc", name: "妇幼健康司", offices: ["综合处", "妇女卫生处", "儿童卫生处", "出生缺陷防治处"] },
    { id: "nhc_occupational", ministry: "nhc", name: "职业健康司", offices: ["综合处", "预防处", "技术服务管理处", "职业病管理处"] },
    { id: "nhc_population", ministry: "nhc", name: "人口家庭司", offices: ["综合处", "政策协调处", "监测评估处", "家庭发展指导处"] },
    { id: "nhc_publicity", ministry: "nhc", name: "宣传司", offices: ["综合处", "新闻网络处", "宣传处", "健康宣教处"] },
    { id: "nhc_international", ministry: "nhc", name: "国际合作司", offices: ["综合处", "国际组织处", "区域合作处", "港澳台处"] },
    { id: "nhsa_benefits", ministry: "nhsa", name: "待遇保障司", offices: ["筹资待遇处", "医疗救助处", "长期护理保险处", "生育保障处"] },
    { id: "nhsa_services", ministry: "nhsa", name: "医药服务管理司", offices: ["医保目录处", "支付方式改革处", "定点协议管理处", "异地就医结算处", "经济性评价处"] },
    { id: "nhsa_price", ministry: "nhsa", name: "医药价格和招标采购司", offices: ["药品耗材招采处", "医疗服务价格处", "价格监测处", "采购平台处"] },
    { id: "nhsa_fund", ministry: "nhsa", name: "基金监管司", offices: ["基金监管处", "飞行检查处", "信用管理处", "经办稽核处"] },
    { id: "nhsa_planning", ministry: "nhsa", name: "规划财务法规司", offices: ["规划统计处", "法规标准处", "基金预算处", "信息化处"] },
    { id: "cdc_monitoring", ministry: "cdc", name: "监测预警司", offices: ["传染病监测处", "预警处", "信息平台处", "风险评估处"] },
    { id: "cdc_emergency", ministry: "cdc", name: "应急处置司", offices: ["应急综合处", "应急处置处", "队伍装备处", "演练评估处"] },
    { id: "cdc_immunization", ministry: "cdc", name: "卫生与免疫规划司", offices: ["免疫规划处", "健康危害因素处", "学校卫生处", "环境卫生处"] },
    { id: "cdc_supervision", ministry: "cdc", name: "综合监督司", offices: ["监督综合处", "传染病监督处", "公共卫生监督处"] },
    { id: "tcm_admin", ministry: "tcm", name: "医政管理与服务司", offices: ["中医医院管理处", "中药管理处", "中医药服务处", "传承创新处"] },
    { id: "nmpa_drug", ministry: "nmpa", name: "药品注册与监管相关司局", offices: ["药品注册", "药品监管", "医疗器械监管", "综合监管"] },
    { id: "ndrc_social", ministry: "ndrc", name: "社会发展司", offices: ["卫生健康发展", "公共服务", "重大项目"] },
    { id: "mof_social", ministry: "mof", name: "社会保障司", offices: ["卫生健康资金", "医保基金预算", "公共卫生投入"] },
    { id: "mohrss_social", ministry: "mohrss", name: "社会保障与职业能力相关司局", offices: ["工伤保险", "职业能力建设", "专业技术人员管理"] },
    { id: "mca_ageing", ministry: "mca", name: "养老服务与社会救助相关司局", offices: ["养老服务", "社会救助", "儿童福利"] },
    { id: "moe_sports_health", ministry: "moe", name: "体育卫生与艺术教育司", offices: ["学校卫生", "学生健康", "健康教育"] },
    { id: "samr_food", ministry: "samr", name: "食品安全与标准相关司局", offices: ["食品安全协调", "食品生产监管", "标准技术管理"] },
    { id: "other_collab", ministry: "other", name: "协同治理", offices: ["综合协同", "联合发文", "配套执行"] }
  ];

  const fallback = {
    state: ["state_health_reform", "综合政策"],
    nhc: ["nhc_office", "综合处"],
    nhsa: ["nhsa_planning", "综合处"],
    cdc: ["cdc_monitoring", "风险评估处"],
    tcm: ["tcm_admin", "中医药服务处"],
    nmpa: ["nmpa_drug", "综合监管"],
    ndrc: ["ndrc_social", "卫生健康发展"],
    mof: ["mof_social", "卫生健康资金"],
    mohrss: ["mohrss_social", "专业技术人员管理"],
    mca: ["mca_ageing", "养老服务"],
    moe: ["moe_sports_health", "学校卫生"],
    samr: ["samr_food", "食品安全协调"],
    other: ["other_collab", "综合协同"]
  };

  const docPrefixRules = [
    ["国办发", "state", "state_health_reform", "规划部署"],
    ["国办函", "state", "state_health_reform", "综合政策"],
    ["国发", "state", "state_health_reform", "规划部署"],
    ["国卫办医急", "nhc", "nhc_emergency", "医疗应急管理处"],
    ["国卫医急", "nhc", "nhc_emergency", "医疗应急管理处"],
    ["国卫办医政", "nhc", "nhc_medical", "综合处"],
    ["国卫办医", "nhc", "nhc_medical", "综合处"],
    ["国卫医", "nhc", "nhc_medical", "综合处"],
    ["国卫办基层", "nhc", "nhc_primary", "综合处"],
    ["国卫基层", "nhc", "nhc_primary", "综合处"],
    ["国卫办规划", "nhc", "nhc_planning", "综合处"],
    ["国卫规划", "nhc", "nhc_planning", "发展规划处"],
    ["国卫办财务", "nhc", "nhc_finance", "办公室"],
    ["国卫财务", "nhc", "nhc_finance", "预算管理处"],
    ["国卫办法规", "nhc", "nhc_legal", "综合处"],
    ["国卫法规", "nhc", "nhc_legal", "立法处"],
    ["国卫体改", "nhc", "nhc_reform", "综合协调处"],
    ["国卫办应急", "nhc", "nhc_emergency", "综合处"],
    ["国卫应急", "nhc", "nhc_emergency", "医疗应急管理处"],
    ["国卫办疾控", "nhc", "nhc_emergency", "公共卫生医疗管理处"],
    ["国卫疾控", "nhc", "nhc_emergency", "公共卫生医疗管理处"],
    ["国卫办监督", "nhc", "nhc_emergency", "医疗监督和行风管理处"],
    ["国卫监督", "nhc", "nhc_emergency", "医疗监督和行风管理处"],
    ["国卫办科教", "nhc", "nhc_science", "综合处"],
    ["国卫科教", "nhc", "nhc_science", "项目管理处"],
    ["国卫办药政", "nhc", "nhc_drug", "综合处"],
    ["国卫药政", "nhc", "nhc_drug", "药物政策处"],
    ["国卫办食品", "nhc", "nhc_food", "综合处"],
    ["国卫食品", "nhc", "nhc_food", "食品安全标准管理处"],
    ["国卫老龄", "nhc", "nhc_ageing", "健康服务处"],
    ["国卫办老龄", "nhc", "nhc_ageing", "综合处"],
    ["国卫妇幼", "nhc", "nhc_maternal", "妇女卫生处"],
    ["国卫办妇幼", "nhc", "nhc_maternal", "综合处"],
    ["国卫职健", "nhc", "nhc_occupational", "职业病管理处"],
    ["国卫办职健", "nhc", "nhc_occupational", "综合处"],
    ["国卫人口", "nhc", "nhc_population", "政策协调处"],
    ["国卫宣传", "nhc", "nhc_publicity", "宣传处"],
    ["国卫国际", "nhc", "nhc_international", "综合处"],
    ["国中医药医政", "tcm", "tcm_admin", "中医医院管理处"],
    ["国中医药人教", "tcm", "tcm_admin", "传承创新处"],
    ["国中医药科技", "tcm", "tcm_admin", "传承创新处"],
    ["国中医药综合", "tcm", "tcm_admin", "中医药服务处"],
    ["国疾控传防", "cdc", "cdc_monitoring", "传染病监测处"],
    ["国疾控应急", "cdc", "cdc_emergency", "应急处置处"],
    ["国疾控卫免", "cdc", "cdc_immunization", "免疫规划处"],
    ["国疾控综卫免", "cdc", "cdc_immunization", "免疫规划处"],
    ["国疾控综", "cdc", "cdc_monitoring", "风险评估处"],
    ["医保发", "nhsa", "nhsa_planning", "规划统计处"],
    ["医保办发", "nhsa", "nhsa_planning", "规划统计处"],
    ["医保办函", "nhsa", "nhsa_planning", "法规标准处"],
    ["医保函", "nhsa", "nhsa_planning", "法规标准处"],
    ["药监综", "nmpa", "nmpa_drug", "综合监管"],
    ["国药监", "nmpa", "nmpa_drug", "药品监管"],
    ["食药监", "nmpa", "nmpa_drug", "药品监管"],
    ["发改社会", "ndrc", "ndrc_social", "卫生健康发展"],
    ["财社", "mof", "mof_social", "卫生健康资金"],
    ["人社部发", "mohrss", "mohrss_social", "专业技术人员管理"],
    ["民发", "mca", "mca_ageing", "养老服务"],
    ["教体艺", "moe", "moe_sports_health", "学校卫生"]
  ];
  const broadDocPrefixes = new Set(["医保发", "医保办发", "医保函", "医保办函"]);

  const docOfficeRefiners = [
    ["nhc_medical", "医疗资源处", /区域医疗中心|国家医学中心|医疗资源|床位|资源扩容/],
    ["nhc_medical", "护理与康复处", /护理|康复|安宁疗护/],
    ["nhc_medical", "心理健康与精神卫生处", /精神卫生|心理健康|精神障碍/],
    ["nhc_medical", "医疗管理处", /医疗质量|医疗安全|质控|诊疗规范|检查检验结果互认|合理医疗检查/],
    ["nhc_primary", "运行评价处", /医共体|医疗卫生共同体|县域|运行评价|乡村医生|村卫生室/],
    ["nhc_primary", "家庭医生处", /家庭医生|签约服务/],
    ["nhc_primary", "基本公共卫生处", /基本公共卫生|慢病|健康档案/],
    ["nhc_planning", "信息统计处", /信息化|互联网|数据|平台|统计|远程医疗/],
    ["nhc_planning", "爱国卫生工作办公室", /爱国卫生|健康城市|健康乡村|控烟/],
    ["nhc_ageing", "医养结合处", /医养结合|养老|失能/],
    ["nhc_maternal", "儿童卫生处", /儿童|婴幼儿|托育/],
    ["nhc_maternal", "出生缺陷防治处", /出生缺陷|产前筛查|辅助生殖/],
    ["nhsa_services", "医保目录处", /医保目录|药品目录|谈判药品|限定支付/],
    ["nhsa_services", "支付方式改革处", /DRG|DIP|支付方式|付费|总额预算/],
    ["nhsa_price", "药品耗材招采处", /集采|集中带量采购|招标采购|耗材/],
    ["nhsa_price", "医疗服务价格处", /医疗服务价格|价格项目|收费标准/],
    ["nhsa_fund", "基金监管处", /基金监管|欺诈骗保|监督检查/],
    ["nhsa_fund", "飞行检查处", /飞行检查/],
    ["nhsa_benefits", "长期护理保险处", /长期护理|长护险/],
    ["nhsa_benefits", "生育保障处", /生育保险|生育保障|生育津贴/],
    ["cdc_monitoring", "预警处", /预警/],
    ["cdc_immunization", "免疫规划处", /免疫规划|疫苗|接种/],
    ["tcm_admin", "中药管理处", /中药|中药饮片|中成药/],
    ["nmpa_drug", "医疗器械监管", /医疗器械|体外诊断|器械/]
  ];

  const rules = [
    ["tcm", "tcm_admin", "中医医院管理处", /中医医院|中西医协同|中医医疗机构|中医医院评审/],
    ["tcm", "tcm_admin", "中药管理处", /中药|中药饮片|中成药/],
    ["tcm", "tcm_admin", "中医药服务处", /中医药|中医|中医药服务|基层中医药/],
    ["nmpa", "nmpa_drug", "医疗器械监管", /医疗器械|体外诊断|注册证|药械/],
    ["nmpa", "nmpa_drug", "药品监管", /药品监管|药品安全|药品注册|药品经营/],
    ["nhsa", "nhsa_fund", "飞行检查处", /飞行检查|专项检查|现场检查/],
    ["nhsa", "nhsa_fund", "信用管理处", /信用评价|信用管理|信息披露|黑名单|失信/],
    ["nhsa", "nhsa_fund", "经办稽核处", /稽核|经办内控|经办机构|内控管理/],
    ["nhsa", "nhsa_fund", "基金监管处", /基金监管|医保基金|欺诈骗保|违法违规|监督检查|常态化监管/],
    ["nhsa", "nhsa_price", "药品耗材招采处", /集采|集中带量采购|带量采购|药品采购|耗材|招标采购|挂网|中选|配送|结算/],
    ["nhsa", "nhsa_price", "医疗服务价格处", /医疗服务价格|价格项目|价格调整|价格治理|价格立项|收费标准/],
    ["nhsa", "nhsa_services", "支付方式改革处", /DRG|DIP|支付方式|按病种|病组|付费|总额预算/],
    ["nhsa", "nhsa_services", "医保目录处", /医保目录|药品目录|医用耗材目录|谈判药品|限定支付|国家基本医疗保险|商保创新药目录/],
    ["nhsa", "nhsa_services", "异地就医结算处", /异地就医|跨省直接结算|联网结算|转诊备案/],
    ["nhsa", "nhsa_services", "定点协议管理处", /定点医药机构|定点医疗机构|协议管理|医保服务协议/],
    ["nhsa", "nhsa_benefits", "长期护理保险处", /长期护理|长护险/],
    ["nhsa", "nhsa_benefits", "医疗救助处", /医疗救助|困难群众|低收入|救助对象/],
    ["nhsa", "nhsa_benefits", "生育保障处", /生育保险|生育保障|生育津贴/],
    ["nhsa", "nhsa_benefits", "筹资待遇处", /居民医保|职工医保|待遇保障|参保|筹资|报销|门诊共济|大病保险/],
    ["nhsa", "nhsa_planning", "信息化处", /医保信息化|医保信息平台|医保电子凭证|编码标准|医保码/],
    ["nhc", "nhc_primary", "家庭医生处", /家庭医生|签约服务|家庭病床/],
    ["nhc", "nhc_primary", "运行评价处", /县域医共体|紧密型|医疗卫生共同体|基层医疗卫生机构医疗质量|基层运行|乡村医生|村卫生室|乡镇卫生院|社区卫生服务/],
    ["nhc", "nhc_primary", "基本公共卫生处", /基本公共卫生|慢病管理|老年人健康管理|健康档案|两癌检查|地方病防治/],
    ["cdc", "cdc_monitoring", "预警处", /传染病疫情预警|疫情预警|预警管理/],
    ["cdc", "cdc_monitoring", "传染病监测处", /传染病监测|疫情监测|监测预警|法定传染病/],
    ["cdc", "cdc_immunization", "免疫规划处", /免疫规划|疫苗|接种|百白破|白破/],
    ["cdc", "cdc_immunization", "环境卫生处", /环境卫生|饮用水|公共场所卫生|健康危害因素/],
    ["cdc", "cdc_immunization", "学校卫生处", /学校卫生|学生健康|校园/],
    ["cdc", "cdc_emergency", "应急处置处", /疾控应急|疫情处置|突发急性传染病|应急处置/],
    ["nhc", "nhc_emergency", "医疗应急管理处", /医疗应急|卫生应急|突发公共卫生|应急预案|重大疫情|紧急医学救援/],
    ["nhc", "nhc_emergency", "医疗应急指导处", /医疗救治|应急救治|重症救治|救援队伍/],
    ["nhc", "nhc_emergency", "公共卫生医疗管理处", /重大疾病|慢性病防控|艾滋|结核|传染病医疗|公共卫生医疗/],
    ["nhc", "nhc_emergency", "血液管理处", /血液|采供血|献血/],
    ["nhc", "nhc_emergency", "医疗监督和行风管理处", /行风|医疗监督|纠风|廉洁|投诉|依法执业|综合监管/],
    ["nhc", "nhc_medical", "心理健康与精神卫生处", /精神卫生|心理健康|精神障碍/],
    ["nhc", "nhc_medical", "护理与康复处", /护理|康复|安宁疗护/],
    ["nhc", "nhc_medical", "医疗管理处", /医疗质量|质量安全|医院感染|医疗安全|临床路径|诊疗规范|医疗技术|病历|质控指标|检查检验结果互认|合理医疗检查/],
    ["nhc", "nhc_medical", "医疗机构处", /医院|医疗机构|县医院|中医医院|专科|区域医疗中心|急救|诊所|门诊部|医疗服务体系/],
    ["nhc", "nhc_medical", "医疗资源处", /医疗资源|床位|医学中心|区域医疗|资源扩容|医疗卫生服务体系/],
    ["nhc", "nhc_reform", "公立医院改革处", /公立医院|现代医院管理|薪酬|绩效|公立医院高质量发展/],
    ["nhc", "nhc_reform", "督导评价处", /督导|评价|考核|监测评价/],
    ["nhc", "nhc_reform", "综合协调处", /医改|医药卫生体制改革|改革重点任务|三医联动|分级诊疗|医联体|双向转诊|上下转诊/],
    ["nhc", "nhc_science", "医学教育处", /继续医学教育|医学教育|住院医师规范化培训|专科医师|学分管理|人才培养/],
    ["nhc", "nhc_science", "生物安全处", /生物安全|实验室安全|病原微生物/],
    ["nhc", "nhc_food", "食品安全标准管理处", /食品安全国家标准|食品标准|食品添加剂|食品接触材料|预包装食品标签|特殊膳食/],
    ["nhc", "nhc_food", "食品安全风险监测与评估处", /食品安全风险监测|风险评估|食源性疾病|食品安全风险/],
    ["nhc", "nhc_food", "食品营养处", /食品营养|营养健康|国民营养|特殊医学用途配方食品/],
    ["nhc", "nhc_maternal", "出生缺陷防治处", /出生缺陷|产前筛查|新生儿疾病筛查|辅助生殖/],
    ["nhc", "nhc_maternal", "儿童卫生处", /儿童健康|儿童医疗|儿童保健|婴幼儿|托育|早期发展/],
    ["nhc", "nhc_maternal", "妇女卫生处", /妇幼|妇女|母婴|孕产妇|生育友好医院|母婴安全/],
    ["nhc", "nhc_population", "家庭发展指导处", /健康家庭|家庭发展|计划生育特殊家庭|托育|婴幼儿照护|普惠托育/],
    ["nhc", "nhc_population", "政策协调处", /优化生育|生育支持|生育友好|人口长期均衡|三孩/],
    ["nhc", "nhc_population", "监测评估处", /人口监测|监测预警|人口预测|人口评估/],
    ["nhc", "nhc_ageing", "医养结合处", /医养结合|养老|失能老人/],
    ["nhc", "nhc_ageing", "健康服务处", /老龄|老年健康|老年人|老年医学|老年病|安宁疗护|临终关怀/],
    ["nhc", "nhc_occupational", "职业病管理处", /职业病|尘肺|职业病诊断|职业病防治/],
    ["nhc", "nhc_occupational", "技术服务管理处", /职业卫生技术服务|职业健康检查|放射卫生|技术服务/],
    ["nhc", "nhc_occupational", "预防处", /职业病危害|危害监测|职业健康风险|健康企业|职业健康保护/],
    ["tcm", "tcm_admin", "中医医院管理处", /中医医院|中西医协同|中医医疗机构|中医医院评审/],
    ["tcm", "tcm_admin", "中药管理处", /中药|中药饮片|中成药/],
    ["tcm", "tcm_admin", "中医药服务处", /中医药|中医|中医药服务|基层中医药/],
    ["nhc", "nhc_drug", "药品供应保障协调处", /短缺药|短缺药品|药品供应|药品保障/],
    ["nhc", "nhc_drug", "药物政策处", /合理用药|处方管理|外配处方|药物政策|基本药物/],
    ["nhc", "nhc_drug", "药品目录管理处", /基本药物目录|罕见病目录|药品目录/],
    ["nhc", "nhc_publicity", "健康宣教处", /健康教育|健康促进|科普|健康宣教|健康知识/],
    ["nhc", "nhc_international", "国际组织处", /世界卫生组织|国际组织|全球卫生/],
    ["nhc", "nhc_legal", "立法处", /法律|条例|办法|规章|传染病防治法|基本医疗卫生与健康促进法/],
    ["nhc", "nhc_legal", "标准处", /卫生标准|国家标准|行业标准|标准化/],
    ["nhc", "nhc_finance", "预算管理处", /预算|财政补助|资金管理|基本公共卫生服务经费/],
    ["nhc", "nhc_finance", "资产管理处", /设备更新|资产|医疗设备|配置许可/],
    ["nhc", "nhc_finance", "乡村振兴处", /乡村振兴|健康扶贫|脱贫地区/],
    ["nhc", "nhc_hr", "专业人才管理处", /卫生健康人才|专业技术人员|医师资格|护士执业|人才队伍/],
    ["nhc", "nhc_hr", "劳动工资处", /薪酬|工资|绩效工资/],
    ["nhc", "nhc_planning", "信息统计处", /信息化|互联网|智慧医院|电子健康|数据|互联互通|远程医疗|统计|全民健康信息平台/],
    ["nhc", "nhc_planning", "爱国卫生工作办公室", /爱国卫生|健康城市|健康乡村|健康环境|控烟|烟草控制/],
    ["nhc", "nhc_planning", "发展规划处", /规划|纲要|实施方案|健康中国|健康行动|体系建设|资源配置|十四五|十五五/],
    ["nhc", "nhc_planning", "建设装备处", /建设项目|基础设施|装备|设备配置|能力建设/],
    ["nmpa", "nmpa_drug", "医疗器械监管", /医疗器械|体外诊断|注册证|药械/],
    ["nmpa", "nmpa_drug", "药品监管", /药品监管|药品安全|药品注册|药品经营/],
    ["ndrc", "ndrc_social", "重大项目", /区域医疗中心|国家医学中心|重大项目|基础设施/],
    ["mof", "mof_social", "公共卫生投入", /财政补助|转移支付|公共卫生资金|补助资金/],
    ["mohrss", "mohrss_social", "工伤保险", /工伤|工伤保险|工伤预防/],
    ["mca", "mca_ageing", "养老服务", /养老服务|养老机构|老年人福利|医养结合/],
    ["moe", "moe_sports_health", "学校卫生", /学校卫生|学生健康|近视|儿童青少年/],
    ["samr", "samr_food", "食品安全协调", /食品安全|市场监管|食品生产|特殊食品/]
  ];

  const byMinistry = new Map(ministries.map((item) => [item.id, item]));
  const byBureau = new Map(bureaus.map((item) => [item.id, item]));

  function textOf(policy) {
    return [
      policy.t, policy.pc, policy.og, policy.ogk, policy.s,
      (policy.th || []).join(" ")
    ].filter(Boolean).join(" ");
  }

  function extractDocNo(policy) {
    const text = [policy.pc, policy.t, policy.s].filter(Boolean).join(" ");
    const match = text.match(/[\u4e00-\u9fa5A-Za-z]{1,16}〔\d{4}〕\d+号/);
    return match ? match[0] : "";
  }

  function docPrefixOf(docNo) {
    return docNo ? docNo.split("〔")[0] : "";
  }

  function classifyByDocNo(policy, text) {
    const docNo = extractDocNo(policy);
    const prefix = docPrefixOf(docNo);
    if (!prefix) return null;
    const rule = docPrefixRules.find(([rulePrefix]) => prefix.startsWith(rulePrefix));
    if (!rule) return null;
    const [rulePrefix, ministryId, bureauId, defaultOffice] = rule;
    const refined = docOfficeRefiners.find(([candidateBureau, , pattern]) => {
      const candidate = byBureau.get(candidateBureau);
      return pattern.test(text) &&
        (candidateBureau === bureauId || (broadDocPrefixes.has(rulePrefix) && candidate?.ministry === ministryId));
    });
    return {
      ministryId,
      bureauId: refined ? refined[0] : bureauId,
      office: refined ? refined[1] : defaultOffice,
      docNo,
      docPrefix: prefix
    };
  }

  function detectMinistries(text) {
    const found = ministries
      .filter((ministry) => ministry.aliases.some((alias) => text.includes(alias)))
      .map((ministry) => ministry.id);
    return [...new Set(found)];
  }

  function classify(policy) {
    const text = textOf(policy);
    const matchedMinistries = detectMinistries(text);
    const docRule = classifyByDocNo(policy, text);
    const rule = docRule ? null : rules.find((item) => item[3].test(text));
    const primary = docRule?.ministryId || rule?.[0] || matchedMinistries[0] || "other";
    const ministriesForPolicy = matchedMinistries.includes(primary)
      ? matchedMinistries
      : [primary, ...matchedMinistries];
    const [bureauId, office] = docRule
      ? [docRule.bureauId, docRule.office]
      : rule
      ? [rule[1], rule[2]]
      : (fallback[primary] || fallback.other);
    const ministry = byMinistry.get(primary) || byMinistry.get("other");
    const bureau = byBureau.get(bureauId) || byBureau.get("other_collab");
    return {
      ministryId: primary,
      ministryName: ministry.name,
      ministryIds: ministriesForPolicy,
      bureauId,
      bureauName: bureau.name,
      office,
      assignment: docRule ? "文号归口" : rule ? "规则归口" : "机关归口",
      docNo: docRule?.docNo || extractDocNo(policy),
      docPrefix: docRule?.docPrefix || docPrefixOf(extractDocNo(policy))
    };
  }

  window.POLICY_TAXONOMY = {
    ministries,
    bureaus,
    byMinistry,
    byBureau,
    classify,
    bureausFor(ministryId) {
      return bureaus.filter((item) => !ministryId || item.ministry === ministryId);
    },
    officesFor(bureauId) {
      return byBureau.get(bureauId)?.offices || [];
    }
  };
})();
