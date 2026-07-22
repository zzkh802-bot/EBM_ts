import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { GuidelineMcpClient, readGuideline, searchGuidelines } from "../tools/guidelineMcp.js";
import { archiveDetails, archiveToolText, readableArchivePath } from "./archiveOutput.js";
import { piSessionDirectory } from "./sessionPath.js";

const DEFAULT_GUIDELINE_MCP_URL = "http://172.20.252.15:8000/mcp";

export function registerGuidelineTools(pi: Pick<ExtensionAPI, "registerTool" | "events">): void {
  const timeout = Number(process.env.GUIDELINE_MCP_TIMEOUT_MS ?? 120_000);
  const client = new GuidelineMcpClient({
    endpoint: process.env.GUIDELINE_MCP_URL ?? DEFAULT_GUIDELINE_MCP_URL,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000,
  });

  pi.registerTool({
    name: "guideline_mcp_search",
    label: "Search Guideline Library",
    description: "Search the internal guideline MCP sequentially and archive the returned document-level results.",
    promptSnippet: "Search the internal guideline index for document IDs",
    promptGuidelines: ["Search first, then use guideline_mcp_read on the best doc_id before creating evidence."],
    parameters: Type.Object({
      query: Type.String({ minLength: 2, description: "Prefer a short high-information English query" }),
      topk: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      source_institution: Type.Optional(Type.String()),
      clinical_department: Type.Optional(Type.String({ description: "Chinese department name expected by the internal index" })),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Searching internal guideline library…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const result = await searchGuidelines({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        query: params.query,
        client,
        ...(params.topk === undefined ? {} : { topk: params.topk }),
        ...(params.source_institution ? { sourceInstitution: params.source_institution } : {}),
        ...(params.clinical_department ? { clinicalDepartment: params.clinical_department } : {}),
      });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      const output = archiveToolText(result.archive, readableArchivePath(sessionId, result.archive.path));
      pi.events.emit("ebm:source_archived", { sessionId, provider: "guideline_mcp", path: result.archive.path, kind: "search" });
      return {
        content: [{ type: "text", text: output.text }],
        details: { archive: archiveDetails(result.archive), truncated: output.truncated },
      };
    },
  });

  pi.registerTool({
    name: "guideline_mcp_read",
    label: "Read Guideline",
    description: "Read one full guideline from the internal MCP by doc_id or exact title and archive it before exposure.",
    promptSnippet: "Read and archive a guideline selected from internal search",
    parameters: Type.Object({
      doc_id: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      max_chars: Type.Optional(Type.Integer({ minimum: 1000, maximum: 500_000 })),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Reading and archiving guideline…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const result = await readGuideline({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        client,
        ...(params.doc_id ? { docId: params.doc_id } : {}),
        ...(params.title ? { title: params.title } : {}),
        ...(params.max_chars === undefined ? {} : { maxChars: params.max_chars }),
      });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      const output = archiveToolText(result.archive, readableArchivePath(sessionId, result.archive.path), { compactRead: true });
      pi.events.emit("ebm:source_archived", { sessionId, provider: "guideline_mcp", path: result.archive.path, kind: "read" });
      return {
        content: [{ type: "text", text: output.text }],
        details: { archive: archiveDetails(result.archive), truncated: output.truncated },
      };
    },
  });
}
