import { postJson } from './http'
export const evidenceTools = {
  panel: (body: unknown) => postJson('/evidence/panel', body),
  grade: (body: unknown) => postJson('/grade', body),
  gradeBulk: (body: unknown) => postJson('/grade/bulk', body),
  extract: (body: unknown) => postJson('/evidence/extract', body),
  benchmark: (body: unknown) => postJson('/evidence/benchmark', body),
  qaBenchmark: (body: unknown) => postJson('/qa/benchmark', body),
}
