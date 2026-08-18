import { createPiRpcExecutor, loadRuntimeConfig, type AgentRunInput } from "../src/server/agentApi.js";
import { randomUUID } from "node:crypto";

/**
 * A small live regression set for the fast, reader-facing answer path.  The
 * cases deliberately cover different decision types so a prompt change cannot
 * be judged from one disease or one writing pattern alone.
 */
const CASES = [
  ["bronchitis", "我今年35岁，没有慢性病，感冒后咳嗽10天，痰有点黄但没有气短或高热。医生建议我吃抗生素，我想知道这通常有没有必要，什么情况才需要尽快就医？"],
  ["aspirin_pregnancy", "我曾经有过一次子痫前期，现在刚怀孕8周。低剂量阿司匹林真的能预防再次发生吗？什么时候开始、有哪些风险、我还需要和产科医生确认什么？"],
  ["thyroid", "体检发现促甲状腺激素偏低，但我没有明显不舒服。这个结果代表什么？下一步通常要复查或做哪些检查，为什么不能只凭一次化验就判断甲亢？"],
  ["insomnia", "我失眠半年了，入睡很困难，白天也累。认知行为治疗和安眠药分别能帮到什么？如果我是第一次寻求治疗，通常应该怎样选择？"],
  ["knee_oa", "我妈妈68岁，膝骨关节炎疼得厉害，朋友推荐玻尿酸注射。它是否值得做？和运动、减重、止痛药相比，获益、风险和适合人群怎样理解？"],
  ["chest_pain", "我父亲58岁，有高血压，今天胸口闷了20分钟后缓解了。急诊说心电图暂时没有明显异常。高敏肌钙蛋白检查能排除心梗吗？现在最重要的处理是什么？"],
  ["statin_older", "我76岁，没有心梗或脑卒中史，但有高血压和轻度高胆固醇。为了预防第一次心血管事件，我现在开始吃他汀值得吗？希望能把可能获益、不确定性和副作用讲明白。"],
  ["pneumonia", "我30岁，社区获得性肺炎正在口服抗生素，第三天退烧且精神好转。一般需要吃满多久？太早停药和吃得太久各有什么问题，哪些变化说明应尽快复诊？"],
] as const;

const rootDir = process.cwd();
const config = await loadRuntimeConfig(rootDir);
const executor = createPiRpcExecutor({ rootDir, maxConcurrentSessions: 8 });
const startedAt = Date.now();

try {
  const results = await Promise.all(CASES.map(async ([id, question]) => {
    const input: AgentRunInput = {
      runId: randomUUID(),
      question,
      audienceMode: "public",
      thinkingLevel: "low",
      researchMode: "quick",
      searchEnabled: true,
      retrievalPolicy: "all",
      responseMode: "answer",
      maxIterations: 8,
      requestTimeoutSeconds: 600,
      provider: config.default_provider,
      model: config.default_model,
    };
    const result = await executor(input, {
      signal: new AbortController().signal,
      setSessionId: () => undefined,
      onTrace: () => undefined,
      onProgress: () => undefined,
      onTool: () => undefined,
    });
    return { id, elapsed_seconds: Math.round((Date.now() - startedAt) / 100) / 10, ...result };
  }));
  process.stdout.write(`${JSON.stringify({
    provider: config.default_provider,
    model: config.default_model,
    wall_seconds: Math.round((Date.now() - startedAt) / 100) / 10,
    results,
  }, null, 2)}\n`);
} finally {
  await executor.dispose();
}
