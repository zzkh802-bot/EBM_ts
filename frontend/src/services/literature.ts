import type { LiteratureSearchResponse } from '../types/domain'
import { postJson } from './http'
export const literatureService = {
  search: (query: string, signal: AbortSignal) =>
    postJson<LiteratureSearchResponse>('/literature/search', { query, retmax: 8 }, signal),
}
