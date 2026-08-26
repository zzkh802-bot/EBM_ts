# 患者端健康问答

本分支 `develop--patience` 将患者端拆成两个互不混用的流程：

- 健康问答：回答当前健康问题，重点展示结论、可以做什么、风险信号和何时就医。
- 就诊准备：只帮助患者整理自己的陈述，继续使用 `/api/v1/patient-intake/*`，不做诊断或治疗建议。

## 当前交付

患者健康问答仍然使用既有 `POST /api/v1/agent-runs`，请求使用：

```json
{
  "question": "孩子流鼻血时第一步怎么做？",
  "audience_mode": "patient",
  "research_mode": "quick",
  "thinking_level": "low",
  "response_mode": "answer",
  "search_enabled": true
}
```

服务端继续保存检索轨迹和来源，但患者可见响应不展示来源编号、内部工具名或参考文献列表。完成后的响应新增 `patient_health`：

```json
{
  "contract_version": "xunyi-patient-health/v1",
  "status": "answered",
  "bottom_line": "……",
  "actions": ["……"],
  "red_flags": ["……"],
  "when_to_seek_care": "……",
  "follow_up_questions": ["……"],
  "uncertainty": "……",
  "safety": {
    "level": "routine",
    "needs_urgent_care": false
  }
}
```

`level` 只能使用以下值：

- `routine`：可先按一般建议观察。
- `clarification_needed`：缺少会影响判断的关键信息。
- `prompt_medical_review`：建议安排线下评估。
- `urgent`：需要尽快就医。
- `emergency`：需要立即求助或急救。

前端优先渲染 `patient_health` 卡片；如果连接的是尚未升级的服务，只返回纯文本，也会使用保底解析，不会让页面空白。

## 分阶段路线

### 阶段一：安全健康问答（本分支）

- 移动端优先的对话入口和快捷问题。
- 结论、行动、风险、就医时机、待补充信息和不确定性分区呈现。
- 患者模式固定走 quick 检索，不生成医生端正式循证报告。
- 禁止个人确诊、个体化处方、缺少关键背景时给出具体剂量。
- 医生端 `xunyi-research/v1` 和就诊准备接口保持兼容。

### 阶段二：风险分层和交互补全

- 对胸痛、呼吸困难、意识改变、严重过敏、明显出血等高风险主题增加服务端规则闸门。
- 在给出建议前，以最少问题补充年龄、孕哺、过敏、用药和症状时间线。
- 将用药建议限制为一般信息；个体化剂量和调整交给线下医生或药师。
- 增加“转给医生/生成就诊准备”的明确交接，而不是把患者回答直接当作诊断报告。

### 阶段三：患者端产品化和人工验收

- 做移动端可用性、无障碍、隐私和会话删除测试。
- 建立患者问题集，人工检查结论安全性、红旗召回、过度确定性和行动可执行性。
- 对高风险失败设置阻断验收；未通过时不开放患者公网入口。

患者端回答是健康教育和就医分流辅助，不能替代面诊、急救或医生的个体化判断。
