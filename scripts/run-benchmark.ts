import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";

const CASES = [
  {
    id: "01_stroke",
    query: "在发病 4 小时、CT 排除颅内出血、血压 165/95 mmHg 的急性缺血性脑卒中患者中，静脉 rt-PA 溶栓及溶栓前后血压管理相比常规治疗，对功能结局、症状性颅内出血和死亡的获益与风险如何？",
  },
  {
    id: "02_aml",
    query: "在首次完全缓解的成人急性髓系白血病患者中，大剂量阿糖胞苷巩固治疗相比标准剂量多药联合巩固化疗，对无病生存、总生存、复发和严重不良反应的影响如何？",
  },
  {
    id: "03_ckd",
    query: "在慢性肾病合并蛋白尿患者中，RAS 抑制剂和 SGLT2 抑制剂相较于常规降压降糖对eGFR decline、proteinuria、hyperkalemia的疗效和安全性证据如何？",
  },
  {
    id: "04_iga",
    query: "在IgA 肾病蛋白尿持续患者中，支持治疗和免疫治疗选择相较于单纯观察对proteinuria remission、eGFR decline、infection的疗效和安全性证据如何？",
  },
  {
    id: "05_preeclampsia",
    query: "在子痫前期高危孕妇中，低剂量阿司匹林预防相较于不预防能否改善preeclampsia、preterm birth、bleeding，同时其安全性边界如何？",
  },
  {
    id: "06_hyperthyroid",
    query: "在疑似甲状腺功能亢进患者的诊断场景中，TSH、FT4 和病因学检查相较于单凭症状判断能否提高诊断准确性，并改变后续临床决策？",
  },
];

type CaseDef = (typeof CASES)[number];

type Args = {
  dryRun: boolean;
  force: boolean;
  resume: boolean;
  runId?: string;
  only?: Set<string>;
  timeoutMs: number;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: Args = { dryRun: true, force: false, resume: false, timeoutMs: 20 * 60 * 1000 };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--execute") parsed.dryRun = false;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--resume") parsed.resume = true;
    else if (arg === "--run-id") {
      const value = args[++i];
      if (!value) throw new Error("--run-id requires a value");
      parsed.runId = value;
    } else if (arg === "--case") {
      const value = args[++i];
      if (!value) throw new Error("--case requires a value");
      parsed.only = new Set(value.split(",").filter(Boolean));
    } else if (arg === "--timeout-ms") {
      const value = args[++i];
      if (!value) throw new Error("--timeout-ms requires a value");
      parsed.timeoutMs = Number(value);
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) throw new Error("--timeout-ms must be positive");
  if (parsed.force && parsed.resume) throw new Error("Use only one of --force or --resume");
  return parsed;
}

function beijingRunId(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}_${get("hour")}${get("minute")}${get("second")}`;
}

function sessionNeedle(runId: string, caseId: string): string {
  return `bench-${runId.replaceAll("_", "-")}-${caseId.replaceAll("_", "-")}`.toLowerCase();
}

function finalPrompt(query: string): string {
  return `${query}\n\n请完成完整循证研究，并最终必须调用 report_write 写入一份 Markdown 报告。报告正文只使用真实参考文献编号如 [1]，不要在正文中出现 ev_；如果证据不足，请在报告中说明证据不足和适用边界。`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function listBenchSessions(runId: string, caseId: string): Promise<string[]> {
  const root = path.resolve("data", "sessions");
  if (!(await exists(root))) return [];
  const needle = sessionNeedle(runId, caseId);
  const entries = await readdir(root, { withFileTypes: true });
  const hits = entries
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().includes(needle))
    .map((entry) => path.join(root, entry.name));
  hits.sort();
  return hits;
}

async function reportFiles(sessionDir: string): Promise<string[]> {
  const reportsDir = path.join(sessionDir, "reports");
  if (!(await exists(reportsDir))) return [];
  const entries = await readdir(reportsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.endsWith(".metadata.json"))
    .map((entry) => path.join(reportsDir, entry.name));
  files.sort();
  return files;
}

async function latestFile(files: string[]): Promise<string> {
  const stats = await Promise.all(files.map(async (file) => ({ file, mtimeMs: (await stat(file)).mtimeMs })));
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats[0]!.file;
}

async function parseTrace(sessionDir: string): Promise<{ prompt: string; reportWriteCalls: number; toolErrors: number; jsonl: string }> {
  const jsonl = path.join(sessionDir, "trace", "trajectory.jsonl");
  const text = await readFile(jsonl, "utf8");
  let prompt = "";
  let reportWriteCalls = 0;
  let toolErrors = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const event = obj.event ?? obj.type;
    const data = obj.data ?? obj.payload ?? {};
    if (!prompt && event === "run_start" && typeof data.prompt === "string") prompt = data.prompt;
    const toolName = data.tool_name ?? data.toolName ?? data.name;
    if (event === "tool_start" && toolName === "report_write") reportWriteCalls += 1;
    if ((event === "tool_error" || event === "tool_result") && (data.error || data.isError)) toolErrors += 1;
  }
  return { prompt, reportWriteCalls, toolErrors, jsonl };
}

function contaminationWarnings(caseId: string, text: string): string[] {
  const topicKeywords: Record<string, string[]> = {
    "01_stroke": ["脑卒中", "卒中", "rt-PA", "阿替普酶", "溶栓"],
    "02_aml": ["急性髓系", "AML", "阿糖胞苷", "巩固治疗"],
    "03_ckd": ["慢性肾病", "CKD", "SGLT2", "RAS", "高钾"],
    "04_iga": ["IgA", "IgAN", "肾病", "Nefecon", "TESTING"],
    "05_preeclampsia": ["子痫前期", "阿司匹林", "早产", "妊娠"],
    "06_hyperthyroid": ["甲亢", "甲状腺", "TSH", "FT4", "TRAb"],
  };
  const warnings: string[] = [];
  for (const [otherId, keywords] of Object.entries(topicKeywords)) {
    if (otherId === caseId) continue;
    if ((caseId === "03_ckd" && otherId === "04_iga") || (caseId === "04_iga" && otherId === "03_ckd")) continue;
    const hits = keywords.filter((keyword) => text.includes(keyword));
    if (hits.length >= 2) warnings.push(`possible ${otherId} contamination: ${hits.slice(0, 3).join(",")}`);
  }
  return warnings;
}

async function validateCase(runId: string, caseDef: CaseDef, outDir: string): Promise<{ sessionDir: string; report: string; warnings: string[] }> {
  const sessions = await listBenchSessions(runId, caseDef.id);
  if (sessions.length !== 1) throw new Error(`${caseDef.id}: expected exactly 1 session, found ${sessions.length}: ${sessions.join(", ")}`);
  const sessionDir = sessions[0]!;
  const trace = await parseTrace(sessionDir);
  if (!trace.prompt.includes(caseDef.query)) throw new Error(`${caseDef.id}: trace prompt does not contain the intended query`);
  if (trace.reportWriteCalls < 1) throw new Error(`${caseDef.id}: report_write was not called`);
  const reports = await reportFiles(sessionDir);
  if (reports.length < 1) throw new Error(`${caseDef.id}: no report markdown was written`);
  const report = await latestFile(reports);
  const reportText = await readFile(report, "utf8");
  if (reportText.length < 2500) throw new Error(`${caseDef.id}: report too short (${reportText.length} chars)`);
  if (/ev_[a-f0-9]{16}/i.test(reportText)) throw new Error(`${caseDef.id}: raw evidence id leaked into report markdown`);
  if (!/(^|\n)#{1,3}\s*(参考文献|References)\s*$/m.test(reportText)) throw new Error(`${caseDef.id}: missing reference section`);
  if (!/\[\d+(?:\s*[,，]\s*\d+)*\]/.test(reportText)) throw new Error(`${caseDef.id}: no numbered citations found`);
  const metadata = `${report}.metadata.json`;
  if (!(await exists(metadata))) throw new Error(`${caseDef.id}: missing report metadata json`);
  const warnings = contaminationWarnings(caseDef.id, reportText);
  const copiedReport = path.join(outDir, "reports", `${caseDef.id}.md`);
  const copiedMetadata = path.join(outDir, "reports", `${caseDef.id}.metadata.json`);
  const wall = await readWallSeconds(path.join(outDir, "logs", `${caseDef.id}.stderr.log`));
  await writeFile(
    copiedReport,
    [
      `# Benchmark ${caseDef.id}`,
      "",
      "## Query",
      "",
      `> ${caseDef.query}`,
      "",
      "## Session",
      "",
      `- Session workspace: \`${path.relative(process.cwd(), sessionDir)}\``,
      `- Original report: \`${path.relative(process.cwd(), report)}\``,
      `- Wall seconds: ${wall ?? "NA"}`,
      "",
      "## Report",
      "",
      reportText,
    ].join("\n"),
  );
  await copyFile(metadata, copiedMetadata);
  await runTraceAnalyze(trace.jsonl, path.join(outDir, "traces", `${caseDef.id}.trace.md`));
  return { sessionDir, report, warnings };
}

async function readWallSeconds(stderrPath: string): Promise<string | undefined> {
  try {
    const text = await readFile(stderrPath, "utf8");
    return text.match(/WALL_SECONDS=([0-9.]+)/)?.[1];
  } catch {
    return undefined;
  }
}

async function runTraceAnalyze(tracePath: string, outputPath: string): Promise<void> {
  const child = spawn("npm", ["run", "trace:analyze", "--", tracePath], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  if (code !== 0) throw new Error(`trace:analyze failed for ${tracePath}: ${stderr}`);
  await writeFile(outputPath, stdout);
}

async function runCase(runId: string, caseDef: CaseDef, outDir: string, timeoutMs: number): Promise<void> {
  const name = `BENCH-${runId}-${caseDef.id}`;
  const stdoutPath = path.join(outDir, "logs", `${caseDef.id}.stdout.log`);
  const stderrPath = path.join(outDir, "logs", `${caseDef.id}.stderr.log`);
  const stdout = createWriteStream(stdoutPath, { flags: "w" });
  const stderr = createWriteStream(stderrPath, { flags: "w" });
  const started = Date.now();
  const child = spawn("bash", ["scripts/ebm.sh", "--print", "--name", name, finalPrompt(caseDef.query)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
  }, timeoutMs);
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  clearTimeout(timer);
  const elapsedMs = Date.now() - started;
  stderr.write(`WALL_SECONDS=${(elapsedMs / 1000).toFixed(2)}\n`);
  stdout.end();
  stderr.end();
  if (code !== 0) throw new Error(`${caseDef.id}: command failed with exit code ${code}; see ${stderrPath}`);
  await writeFile(path.join(outDir, "logs", `${caseDef.id}.runner.json`), JSON.stringify({ caseId: caseDef.id, name, elapsedMs }, null, 2));
}

async function writeManifest(outDir: string, rows: Array<{ caseId: string; query: string; sessionDir: string; report: string; warnings: string[] }>): Promise<void> {
  const lines = [
    "# EBM Benchmark Reports",
    "",
    "This file is for developer packaging only. Give external evaluators the `reports/*.md` files unless they request trace/log details.",
    "",
    "| Case | Query | Session workspace | Original report | Copied report | Warnings |",
    "|---|---|---|---|---|---|",
  ];
  for (const row of rows) {
    lines.push(`| \`${row.caseId}\` | ${row.query} | \`${path.relative(process.cwd(), row.sessionDir)}\` | \`${path.relative(process.cwd(), row.report)}\` | \`${path.join(path.relative(process.cwd(), outDir), "reports", `${row.caseId}.md`)}\` | ${row.warnings.join("; ") || ""} |`);
  }
  await writeFile(path.join(outDir, "manifest.md"), `${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const runId = args.runId ?? beijingRunId();
  const outDir = path.resolve("data", "benchmark_reports", runId);
  const selected = CASES.filter((caseDef) => !args.only || args.only.has(caseDef.id));
  if (selected.length === 0) throw new Error("No cases selected");

  console.log(`Run id: ${runId}`);
  console.log(`Output: ${path.relative(process.cwd(), outDir)}`);
  console.log(`Mode: ${args.dryRun ? "dry-run (no model calls)" : "execute"}`);
  console.log(`Cases: ${selected.map((caseDef) => caseDef.id).join(", ")}`);

  if (args.force && (await exists(outDir))) await rm(outDir, { recursive: true, force: true });
  if (!args.resume && !args.force && (await exists(outDir))) throw new Error(`Output dir already exists: ${outDir}. Use --resume or --force.`);
  await mkdir(path.join(outDir, "reports"), { recursive: true });
  await mkdir(path.join(outDir, "logs"), { recursive: true });
  await mkdir(path.join(outDir, "traces"), { recursive: true });
  await writeFile(path.join(outDir, "queries.tsv"), `${CASES.map((caseDef) => `${caseDef.id}\t${caseDef.query}`).join("\n")}\n`);
  await writeFile("/tmp/ebm_benchmark_latest_dir", path.relative(process.cwd(), outDir));

  console.log("\nPreflight checks:");
  if (!(await exists("scripts/ebm.sh"))) throw new Error("scripts/ebm.sh missing");
  if (!(await exists("node_modules/.bin/pi"))) throw new Error("node_modules/.bin/pi missing; run npm install");
  if (!(await exists(".pi/extensions/ebm-tools.ts"))) throw new Error("EBM tools extension missing");
  if (!process.env.DEEPSEEK_API_KEY && !(await envFileContains(".env", "DEEPSEEK_API_KEY"))) {
    throw new Error("DEEPSEEK_API_KEY not found in environment or .env");
  }
  for (const caseDef of selected) {
    const existingSessions = await listBenchSessions(runId, caseDef.id);
    const copied = path.join(outDir, "reports", `${caseDef.id}.md`);
    console.log(`- ${caseDef.id}: query chars=${caseDef.query.length}, existing sessions=${existingSessions.length}, copied=${await exists(copied) ? "yes" : "no"}`);
    if (!args.resume && existingSessions.length > 0) throw new Error(`${caseDef.id}: existing session(s) would make validation ambiguous: ${existingSessions.join(", ")}`);
  }

  if (args.dryRun) {
    console.log("\nDry-run complete. No model calls were made.");
    console.log(`To execute serially: ./node_modules/.bin/tsx scripts/run-benchmark.ts --execute --run-id ${runId} --resume`);
    return;
  }

  const rows: Array<{ caseId: string; query: string; sessionDir: string; report: string; warnings: string[] }> = [];
  for (const caseDef of selected) {
    const copied = path.join(outDir, "reports", `${caseDef.id}.md`);
    const existingSessions = await listBenchSessions(runId, caseDef.id);
    if (args.resume && existingSessions.length === 1) {
      console.log(`\nRESUME ${caseDef.id}: validate existing session without rerun`);
      const validated = await validateCase(runId, caseDef, outDir);
      if (validated.warnings.length) console.warn(`WARN ${caseDef.id}: ${validated.warnings.join("; ")}`);
      rows.push({ caseId: caseDef.id, query: caseDef.query, ...validated });
      await writeManifest(outDir, rows);
      console.log(`OK ${caseDef.id}: ${path.relative(process.cwd(), copied)}`);
      continue;
    }
    if (args.resume && (await exists(copied))) {
      console.log(`\nSKIP ${caseDef.id}: copied report already exists`);
      const validated = await validateCase(runId, caseDef, outDir);
      rows.push({ caseId: caseDef.id, query: caseDef.query, ...validated });
      continue;
    }
    console.log(`\nRUN ${caseDef.id}`);
    await runCase(runId, caseDef, outDir, args.timeoutMs);
    console.log(`VALIDATE ${caseDef.id}`);
    const validated = await validateCase(runId, caseDef, outDir);
    if (validated.warnings.length) console.warn(`WARN ${caseDef.id}: ${validated.warnings.join("; ")}`);
    rows.push({ caseId: caseDef.id, query: caseDef.query, ...validated });
    await writeManifest(outDir, rows);
    console.log(`OK ${caseDef.id}: ${path.relative(process.cwd(), copied)}`);
  }
  await writeManifest(outDir, rows);
  console.log(`\nDONE: ${path.relative(process.cwd(), path.join(outDir, "reports"))}`);
}

async function envFileContains(file: string, key: string): Promise<boolean> {
  try {
    return (await readFile(file, "utf8")).split("\n").some((line) => line.trim().startsWith(`${key}=`));
  } catch {
    return false;
  }
}

await main();
