# DP循医 V2 MCP-only Top 9 Good Cases

这些案例来自 213/213 严格有效的 V2 MCP-only 集成测试。筛选优先考虑质量分数、完整报告、MCP/Evidence/引用链完整性，同时保留跨科室和跨任务类型代表性。自动评分不等同于医学正确率，正式展示前仍建议进行逐条 claim-citation 人工复核。

| 排名 | Case | 科室 | 类型 | 分数 | MCP | Evidence | 引用 | 文件 |
|---:|---|---|---|---:|---:|---:|---:|---|
| 1 | ENV13-CARD-001 | 心血管内科 | treatment | 100.0 | 12 | 8 | 26 | [JSON](ENV13-CARD-001.json) · [MD](ENV13-CARD-001.md) |
| 2 | ENV13-HEME-001 | 血液内科 | treatment | 100.0 | 6 | 6 | 12 | [JSON](ENV13-HEME-001.json) · [MD](ENV13-HEME-001.md) |
| 3 | ENV13-ONC-001 | 肿瘤科 | treatment | 100.0 | 9 | 9 | 20 | [JSON](ENV13-ONC-001.json) · [MD](ENV13-ONC-001.md) |
| 4 | ENV13-RESP-001 | 呼吸内科 | treatment | 100.0 | 12 | 8 | 16 | [JSON](ENV13-RESP-001.json) · [MD](ENV13-RESP-001.md) |
| 5 | MCP-D03-C01 | 感染内科 | treatment | 100.0 | 9 | 5 | 17 | [JSON](MCP-D03-C01.json) · [MD](MCP-D03-C01.md) |
| 6 | MCP-D07-C05 | 精神/心理科 | prevention_safety | 100.0 | 11 | 8 | 23 | [JSON](MCP-D07-C05.json) · [MD](MCP-D07-C05.md) |
| 7 | MCP-D09-C04 | 小儿内科 | monitoring | 100.0 | 8 | 7 | 37 | [JSON](MCP-D09-C04.json) · [MD](MCP-D09-C04.md) |
| 8 | MCP-D26-C05 | 生殖医学科 | screening | 100.0 | 9 | 13 | 50 | [JSON](MCP-D26-C05.json) · [MD](MCP-D26-C05.md) |
| 9 | ENV13-RENAL-001 | 肾内科 | treatment | 98.8 | 14 | 7 | 15 | [JSON](ENV13-RENAL-001.json) · [MD](ENV13-RENAL-001.md) |

## 文件说明

- 每个 JSON 包含筛选元数据、benchmark 结果和原始 V2 API 响应。
- 每个 Markdown 包含原始问题、关键指标和正式循证报告。
- `index.json` 可直接用于程序化读取和前端/评测集成。
