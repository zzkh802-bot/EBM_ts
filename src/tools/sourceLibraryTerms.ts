export type QueryExpansionRule = {
  pattern: RegExp;
  terms: string[];
};

export const SOURCE_LIBRARY_QUERY_EXPANSIONS: QueryExpansionRule[] = [
  {
    pattern: /急性髓系白血病|急性髓细胞白血病|\baml\b|acute myeloid leukemia/iu,
    terms: ["AML", "acute", "myeloid", "leukemia", "acute myeloid leukemia", "急性髓系白血病"],
  },
  {
    pattern: /阿糖胞苷|cytarabine|ara-?c/iu,
    terms: ["cytarabine", "Ara-C", "阿糖胞苷"],
  },
  {
    pattern: /大剂量|high[- ]dose|hidac/iu,
    terms: ["high-dose", "HiDAC", "大剂量"],
  },
  {
    pattern: /标准剂量|standard[- ]dose/iu,
    terms: ["standard-dose", "标准剂量"],
  },
  {
    pattern: /多药|multiagent|combination/iu,
    terms: ["multiagent", "combination", "多药联合"],
  },
  {
    pattern: /巩固|缓解后|consolidation|postremission/iu,
    terms: ["consolidation", "postremission", "巩固治疗", "缓解后治疗"],
  },
  {
    pattern: /无病生存|\bdfs\b|disease[- ]free survival/iu,
    terms: ["DFS", "disease-free", "survival", "disease-free survival", "无病生存"],
  },
  {
    pattern: /无复发生存|\brfs\b|relapse[- ]free survival/iu,
    terms: ["RFS", "relapse-free", "survival", "relapse-free survival", "无复发生存"],
  },
  {
    pattern: /总生存|\bos\b|overall survival/iu,
    terms: ["OS", "overall", "survival", "overall survival", "总生存"],
  },
  {
    pattern: /复发|relapse|recurrence/iu,
    terms: ["relapse", "recurrence", "复发"],
  },
  {
    pattern: /不良反应|毒性|安全性|感染|adverse event|toxicity|safety|infection/iu,
    terms: ["adverse", "events", "adverse events", "toxicity", "safety", "infection", "不良反应", "毒性", "安全性", "感染"],
  },
  {
    pattern: /随机|\brct\b|randomi[sz]ed/iu,
    terms: ["randomized", "randomised", "RCT", "randomized trial", "随机对照试验"],
  },
  {
    pattern: /荟萃|系统综述|meta-analysis|systematic review/iu,
    terms: ["meta-analysis", "systematic", "review", "systematic review", "荟萃分析", "系统综述"],
  },
  {
    pattern: /卒中|脑卒中|中风|stroke/iu,
    terms: ["stroke", "ischemic stroke", "脑卒中", "卒中"],
  },
  {
    pattern: /溶栓|阿替普酶|rt-?pa|alteplase|thrombolysis/iu,
    terms: ["thrombolysis", "alteplase", "rt-PA", "recombinant tissue plasminogen activator", "溶栓", "阿替普酶"],
  },
  {
    pattern: /iga肾病|iga nephropathy/iu,
    terms: ["IgA nephropathy", "IgAN", "IgA肾病"],
  },
  {
    pattern: /甲亢|甲状腺功能亢进|graves|hyperthyroidism/iu,
    terms: ["hyperthyroidism", "Graves disease", "thyrotoxicosis", "甲亢", "甲状腺功能亢进"],
  },
  {
    pattern: /子痫前期|先兆子痫|preeclampsia|pre-eclampsia/iu,
    terms: ["preeclampsia", "pre-eclampsia", "子痫前期", "先兆子痫"],
  },
];

export function expandSourceLibraryQueryTerms(value: string): string[] {
  const normalized = value.normalize("NFKC").toLowerCase();
  return SOURCE_LIBRARY_QUERY_EXPANSIONS.flatMap((rule) => rule.pattern.test(normalized) ? rule.terms : []).map((term) => term.toLowerCase());
}
