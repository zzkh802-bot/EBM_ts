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
      attachments: [{ attachment_id: 'att_123', file_name: '病历.png', media_type: 'image/png', size: 12, processed_path: 'artifacts/uploads/att_123-病历.png/full.md' }],
    }), { headers: { 'Content-Type': 'application/json' } })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(workspaceResponse)
      .mockResolvedValueOnce(attachmentsResponse))

    const workspace = await workspaceService.list('session-1')

    expect(workspace.files.map((file) => file.kind)).toEqual(['report', 'report_draft', 'research_frame', 'artifact', 'attachment'])
    expect(workspace.files.at(-1)?.path).toBe('attachments/att_123/病历.png')
    expect(workspace.files.at(-1)?.previewable).toBe(true)
    expect(workspace.files.at(-1)?.preview_path).toBe('artifacts/uploads/att_123-病历.png/full.md')
  })

  it('打开附件时读取 OCR 归档，而不是把二进制原件当作 Markdown', async () => {
    const attachmentsResponse = new Response(JSON.stringify({
      session_id: 'session-1',
      attachments: [{ attachment_id: 'att_123', file_name: '病历.pdf', media_type: 'application/pdf', size: 12, processed_path: 'artifacts/uploads/att_123-病历.pdf/full.md' }],
    }), { headers: { 'Content-Type': 'application/json' } })
    const processedResponse = new Response(JSON.stringify({ session_id: 'session-1', path: 'artifacts/uploads/att_123-病历.pdf/full.md', kind: 'artifact', size: 20, modified_at: '2026-08-01T00:00:00.000Z', media_type: 'text/markdown', previewable: true, content: '# OCR 内容' }), { headers: { 'Content-Type': 'application/json' } })
    const fetchMock = vi.fn().mockResolvedValueOnce(attachmentsResponse).mockResolvedValueOnce(processedResponse)
    vi.stubGlobal('fetch', fetchMock)

    const file = await workspaceService.read('session-1', 'attachments/att_123/病历.pdf')

    expect(file.content).toBe('# OCR 内容')
    expect(fetchMock.mock.calls[1]?.[0]).toContain(`path=${encodeURIComponent('artifacts/uploads/att_123-病历.pdf/full.md')}`)
  })
})
