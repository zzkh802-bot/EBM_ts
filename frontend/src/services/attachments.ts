import type { AttachmentUploadResponse } from '../types/domain'
import { HttpError } from './http'

const ATTACHMENTS_URL = '/ts-api/api/v1/attachments'

export async function uploadAttachment(file: File, clientSessionId?: string): Promise<AttachmentUploadResponse> {
  const response = await fetch(ATTACHMENTS_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
      ...(clientSessionId ? { 'X-Client-Session-Id': clientSessionId } : {}),
    },
    body: file,
  })
  const text = await response.text()
  let payload: AttachmentUploadResponse & { error?: { message?: string } }
  try {
    payload = (text ? JSON.parse(text) : {}) as AttachmentUploadResponse & { error?: { message?: string } }
  } catch {
    throw new HttpError(`附件上传失败 (${response.status})`, response.status, text)
  }
  if (!response.ok) throw new HttpError(payload.error?.message || `附件上传失败 (${response.status})`, response.status, payload)
  return payload
}
