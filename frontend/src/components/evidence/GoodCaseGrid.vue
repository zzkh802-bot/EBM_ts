<script setup lang="ts">
export interface GoodCase { id: string; department: string; title: string; summary: string; question: string }
defineEmits<{ select: [question: string] }>()
const cases: GoodCase[] = [
  { id: 'ENV13-NEURO-001', department: '神经内科', title: '急性卒中静脉溶栓', summary: '4.5 小时时间窗内 rt-PA 与血压管理的获益、出血和死亡风险', question: '在发病 4 小时、CT 排除颅内出血、血压 165/95 mmHg 的急性缺血性脑卒中患者中，静脉 rt-PA 溶栓及溶栓前后血压管理相比常规治疗，对功能结局、症状性颅内出血和死亡的获益与风险如何？' },
  { id: 'ENV13-HEME-001', department: '血液内科', title: 'AML 巩固治疗剂量', summary: '大剂量阿糖胞苷对生存、复发及严重不良反应的影响', question: '在首次完全缓解的成人急性髓系白血病患者中，大剂量阿糖胞苷巩固治疗相比标准剂量多药联合巩固化疗，对无病生存、总生存、复发和严重不良反应的影响如何？' },
  { id: 'MCP-D16-C01', department: '肾内科', title: 'CKD 与 SGLT2 治疗', summary: 'eGFR、蛋白尿、高钾血症和 AKI 的疗效与安全边界', question: '在慢性肾病合并蛋白尿患者中，RAS 抑制剂和 SGLT2 抑制剂相较于常规降压降糖对eGFR decline、proteinuria、hyperkalemia的疗效和安全性证据如何？' },
  { id: 'MCP-D16-C05', department: '肾内科', title: 'IgA 肾病持续蛋白尿', summary: '支持治疗后免疫治疗选择、蛋白尿缓解和感染风险', question: '在IgA 肾病蛋白尿持续患者中，支持治疗和免疫治疗选择相较于单纯观察对proteinuria remission、eGFR decline、infection的疗效和安全性证据如何？' },
  { id: 'MCP-D17-C01', department: '产科', title: '子痫前期阿司匹林预防', summary: '高危孕妇的子痫前期、早产、出血与妊娠安全边界', question: '在子痫前期高危孕妇中，低剂量阿司匹林预防相较于不预防能否改善preeclampsia、preterm birth、bleeding，同时其安全性边界如何？' },
  { id: 'MCP-D06-C02', department: '内分泌科', title: '甲亢诊断路径', summary: 'TSH、FT4 与病因学检查对诊断准确性和临床决策的影响', question: '在疑似甲状腺功能亢进患者的诊断场景中，TSH、FT4 和病因学检查相较于单凭症状判断能否提高诊断准确性，并改变后续临床决策？' },
]
</script>

<template>
  <div class="good-cases">
    <div><strong>循证 Good Cases</strong><small>来自跨科室正式标记 good_case 的完整检索与引用链案例</small></div>
    <button v-for="item in cases" :key="item.id" :data-case-id="item.id" @click="$emit('select', item.question)">
      <span><em>{{ item.department }}</em><strong>{{ item.title }}</strong><small>{{ item.summary }}</small></span><b>填入对话框</b>
    </button>
  </div>
</template>
