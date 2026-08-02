import { afterEach, describe, expect, it, vi } from 'vitest'
import { workspaceService } from '../services/workspace'

afterEach(() => vi.unstubAllGlobals())

describe('医生端工作区文件', () => {
  it('只向医生端返回最终报告和研究框架', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      session_id: 'session-1',
      files: [
        { path: 'reports/final.md', kind: 'report', size: 1, modified_at: '2026-08-01T00:00:00.000Z' },
        { path: 'notes/research_frame.md', kind: 'research_frame', size: 1, modified_at: '2026-08-01T00:00:00.000Z' },
        { path: 'evidence/claim.md', kind: 'evidence', size: 1, modified_at: '2026-08-01T00:00:00.000Z' },
        { path: 'sources/article.md', kind: 'source', size: 1, modified_at: '2026-08-01T00:00:00.000Z' },
      ],
    }), { headers: { 'Content-Type': 'application/json' } })))

    const workspace = await workspaceService.list('session-1')

    expect(workspace.files.map((file) => file.kind)).toEqual(['report', 'research_frame'])
  })
})
