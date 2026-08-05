import { afterEach, describe, expect, it, vi } from 'vitest'
import { workspaceService } from '../services/workspace'

afterEach(() => vi.unstubAllGlobals())

describe('医生端工作区文件', () => {
  it('隐藏内部证据源文件，但保留报告草稿和用户文件', async () => {
    const workspaceResponse = new Response(JSON.stringify({
      session_id: 'session-1',
      files: [
        { path: 'reports/final.md', kind: 'report', size: 1, modified_at: '2026-08-01T00:00:00.000Z' },
        { path: 'reports/drafts/working.draft.md', kind: 'report_draft', size: 1, modified_at: '2026-08-01T00:00:00.000Z' },
        { path: 'notes/research_frame.md', kind: 'research_frame', size: 1, modified_at: '2026-08-01T00:00:00.000Z' },
        { path: 'artifacts/plan.md', kind: 'artifact', size: 1, modified_at: '2026-08-01T00:00:00.000Z' },
        { path: 'evidence/claim.md', kind: 'evidence', size: 1, modified_at: '2026-08-01T00:00:00.000Z' },
        { path: 'sources/article.md', kind: 'source', size: 1, modified_at: '2026-08-01T00:00:00.000Z' },
      ],
    }), { headers: { 'Content-Type': 'application/json' } })
    const attachmentsResponse = new Response(JSON.stringify({
      session_id: 'session-1',
      attachments: [{ attachment_id: 'att_123', file_name: '病历.png', media_type: 'image/png', size: 12 }],
    }), { headers: { 'Content-Type': 'application/json' } })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(workspaceResponse)
      .mockResolvedValueOnce(attachmentsResponse))

    const workspace = await workspaceService.list('session-1')

    expect(workspace.files.map((file) => file.kind)).toEqual(['report', 'report_draft', 'research_frame', 'artifact', 'attachment'])
    expect(workspace.files.at(-1)?.path).toBe('attachments/att_123/病历.png')
  })
})
