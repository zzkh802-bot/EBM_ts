export interface GoodCase {
  id: string
  department: string
  title: string
  summary: string
  question: string
}

export const goodCases: GoodCase[] = [
  {
    id: 'ENV13-CARD-001', department: '心血管内科', title: '房颤卒中预防与抗凝选择',
    summary: '口服抗凝药相较阿司匹林或无抗凝治疗的卒中、大出血和死亡获益风险',
    question: '在伴脑卒中高危因素的非瓣膜性心房颤动患者中，口服抗凝药相比阿司匹林或无抗凝治疗，对脑卒中、系统性栓塞、大出血和死亡的获益与风险如何？',
  },
  {
    id: 'ENV13-HEME-001', department: '血液内科', title: 'AML 巩固治疗剂量选择',
    summary: '大剂量阿糖胞苷相较标准剂量多药方案的生存、复发和严重毒性',
    question: '在首次完全缓解的成人急性髓系白血病患者中，大剂量阿糖胞苷巩固治疗相比标准剂量多药联合巩固化疗，对无病生存、总生存、复发和严重不良反应的影响如何？',
  },
  {
    id: 'ENV13-ONC-001', department: '肿瘤科', title: '化疗患者 G-CSF 预防',
    summary: '中性粒细胞减少性发热、感染、住院、化疗剂量强度与不良反应',
    question: '在接受骨髓抑制性化疗、存在中性粒细胞减少性发热风险的恶性肿瘤患者中，预防性 G-CSF 相比不使用集落刺激因子，对发热性中性粒细胞减少、感染、住院、化疗剂量强度、死亡和不良反应的影响如何？',
  },
  {
    id: 'ENV13-RESP-001', department: '呼吸内科', title: '结核性胸膜炎激素治疗',
    summary: '标准抗结核治疗基础上加用全身激素的症状、胸水、复发与安全性',
    question: '在接受标准抗结核治疗的结核性胸膜炎患者中，加用全身糖皮质激素相比不加用激素，对发热和胸痛缓解、胸水吸收、胸膜增厚粘连、治愈、复发和不良反应的影响如何？',
  },
  {
    id: 'MCP-D03-C01', department: '感染内科', title: '社区获得性肺炎经验治疗',
    summary: '指南一致的经验性抗菌药物对临床治愈、死亡和不良事件的影响',
    question: '在社区获得性肺炎住院患者中，经验性抗菌药物选择相较于延迟或非指南治疗对 clinical cure、mortality、adverse events 的疗效和安全性证据如何？',
  },
  {
    id: 'MCP-D07-C05', department: '精神/心理科', title: '自伤与自杀风险危机干预',
    summary: '安全评估和危机干预对自伤、自杀企图、紧急转诊及安全边界的价值',
    question: '在有自伤或自杀风险患者中，安全评估和危机干预相较于普通门诊随访能否改善 self-harm、suicide attempt、emergency referral，同时其安全性边界如何？',
  },
  {
    id: 'MCP-D09-C04', department: '小儿内科', title: '儿童哮喘长期随访',
    summary: '症状控制和肺功能监测对急性发作、控制水平和生长影响的价值',
    question: '在儿童哮喘长期管理过程中，症状控制和肺功能随访相较于急性发作才处理，对 exacerbation、control、growth 的监测价值和证据边界如何？',
  },
  {
    id: 'MCP-D26-C05', department: '生殖医学科', title: '反复流产病因筛查',
    summary: '遗传、解剖和免疫筛查对诊断收益、活产和避免不必要治疗的作用',
    question: '在反复流产患者中，遗传、解剖和免疫因素筛查相较于经验保胎，对 diagnostic yield、live birth、unnecessary treatment 的获益、伤害和适用边界证据如何？',
  },
  {
    id: 'ENV13-RENAL-001', department: '肾内科', title: 'IgA 肾病激素联合治疗',
    summary: '持续大量蛋白尿患者中激素联合支持治疗的肾脏获益和不良反应',
    question: '在肾功能正常、持续蛋白尿约 3 g/d 且病理慢性损伤较轻的 IgA 肾病患者中，糖皮质激素联合支持治疗相比单纯 ACEI/ARB 等支持治疗，对蛋白尿、肾功能下降、终末期肾病和不良反应的影响如何？',
  },
]
