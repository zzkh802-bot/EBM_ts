export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong' | 'code'; value: string }
  | { type: 'link'; label: string; href: string }
  | { type: 'citation'; number: string }
  | { type: 'break' }

export type ReportNode =
  | { type: 'heading'; level: number; children: InlineNode[]; title: string }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'table'; headers: InlineNode[][]; rows: InlineNode[][][] }
  | { type: 'divider' }

export interface Reference {
  number: string
  content: string
  title: string
  pmid: string
  url: string
}

const REFERENCE_HEADING = /^\s*#{1,6}\s*(?:(?:核心|主要|关键)\s*)?(参考文献|References?|引用来源|文献来源)\s*$/im

export function reportBody(markdown: string) {
  const heading = REFERENCE_HEADING.exec(markdown)
  if (heading?.index !== undefined) return markdown.slice(0, heading.index).trim()
  const lines = markdown.replace(/\r/g, '').split('\n')
  const firstReference = lines.findIndex((line, index) => {
    if (!/^\s*\[\d{1,3}\]\s+\S/.test(line)) return false
    const remaining = lines.slice(index).filter((row) => /^\s*\[\d{1,3}\]\s+\S/.test(row)).length
    return remaining >= 2 || /PMID|doi|https?:\/\/|et al\.?/i.test(line)
  })
  return (firstReference >= 0 ? lines.slice(0, firstReference) : lines).join('\n').trim()
}

export function parseInline(value: string): InlineNode[] {
  const result: InlineNode[] = []
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\[(\d{1,3})\])/g
  value.split('\n').forEach((line, lineIndex) => {
    if (lineIndex) result.push({ type: 'break' })
    let cursor = 0
    for (const match of line.matchAll(pattern)) {
      const index = match.index ?? 0
      if (index > cursor) result.push({ type: 'text', value: line.slice(cursor, index) })
      if (match[2]) result.push({ type: 'strong', value: match[2] })
      else if (match[3]) result.push({ type: 'code', value: match[3] })
      else if (match[4] && match[5]) result.push({ type: 'link', label: match[4], href: match[5] })
      else if (match[6]) result.push({ type: 'citation', number: match[6] })
      cursor = index + match[0].length
    }
    if (cursor < line.length) result.push({ type: 'text', value: line.slice(cursor) })
  })
  return result
}

const tableCells = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => parseInline(cell.trim()))

export function parseReport(markdown: string): ReportNode[] {
  const lines = reportBody(markdown).replace(/\r/g, '').split('\n')
  const nodes: ReportNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index += 1; continue }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      nodes.push({ type: 'heading', level: heading[1].length, title: heading[2], children: parseInline(heading[2]) })
      index += 1; continue
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      nodes.push({ type: 'divider' }); index += 1; continue
    }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || '')) {
      const headers = tableCells(line)
      const rows: InlineNode[][][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|')) {
        rows.push(tableCells(lines[index])); index += 1
      }
      nodes.push({ type: 'table', headers, rows }); continue
    }
    const list = line.match(/^(\s*)(?:([-*+])|(\d+)[.)])\s+(.+)$/)
    if (list) {
      const baseIndent = list[1].length
      const ordered = Boolean(list[3])
      const items: InlineNode[][] = []
      while (index < lines.length) {
        const item = lines[index].match(/^(\s*)(?:([-*+])|(\d+)[.)])\s+(.+)$/)
        if (!item || item[1].length !== baseIndent || Boolean(item[3]) !== ordered) break
        const itemLines = [item[4]]
        index += 1
        while (index < lines.length && lines[index].trim()) {
          const nested = lines[index].match(/^(\s*)(?:([-*+])|(\d+)[.)])\s+(.+)$/)
          if (nested && nested[1].length <= baseIndent) break
          if (nested) {
            itemLines.push(`${nested[3] ? `${nested[3]}.` : '•'} ${nested[4]}`)
            index += 1
            continue
          }
          const continuationIndent = lines[index].match(/^\s*/)?.[0].length ?? 0
          if (continuationIndent <= baseIndent || /^(#{1,6})\s/.test(lines[index])) break
          itemLines.push(lines[index].trim())
          index += 1
        }
        items.push(parseInline(itemLines.join('\n')))
      }
      nodes.push({ type: 'list', ordered, items }); continue
    }
    const paragraph = [line.trim()]
    index += 1
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s/.test(lines[index])) {
      if (/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[index])) break
      if (lines[index].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || '')) break
      paragraph.push(lines[index].trim()); index += 1
    }
    nodes.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) })
  }
  return nodes
}

export function extractReferences(markdown: string): Record<string, Reference> {
  const refs: Record<string, Reference> = {}
  const normalized = markdown.replace(/\r/g, '')
  const heading = REFERENCE_HEADING.exec(normalized)
  const source = heading?.index !== undefined
    ? normalized.slice(heading.index + heading[0].length)
    : normalized
  const marker = heading
    ? /^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)、])\s+(.+)$/
    : /^\s*\[(\d{1,3})\]\s+(.+)$/
  const lines = source.split('\n')
  const entries: Array<{ number: string; lines: string[] }> = []
  for (const line of lines) {
    const match = line.match(marker)
    if (match) {
      entries.push({ number: heading ? (match[1] || match[2]) : match[1], lines: [heading ? match[3] : match[2]] })
      continue
    }
    if (entries.length && line.trim() && !/^#{1,6}\s/.test(line)) entries[entries.length - 1].lines.push(line.trim())
  }
  for (const entry of entries) {
    const content = entry.lines.join(' ').replace(/\s+/g, ' ').trim()
    if (!content) continue
    const pmid = content.match(/PMID[:\s]+(\d{6,9})/i)?.[1] || ''
    refs[entry.number] = {
      number: entry.number,
      content,
      title: content.slice(0, 180),
      pmid,
      url: content.match(/https?:\/\/\S+/)?.[0] || (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : ''),
    }
  }
  return refs
}

const PUBLIC_HIDDEN_SECTION = /PICO|GRADE|证据表|检索策略|PubMed query|方法学|工具轨迹|引用核验|人工复核|研究设计|统计方法|文献筛选|检索结果|证据来源|证据分级|详细证据|效应量|亚组分析|敏感性分析|指南推荐的.*方案|用药方案|剂量方案/i

export function projectReport(nodes: ReportNode[], audience: 'clinician' | 'public'): ReportNode[] {
  if (audience === 'clinician') return nodes
  const result: ReportNode[] = []
  let hiddenLevel = 0
  for (const node of nodes) {
    if (node.type === 'heading') {
      if (PUBLIC_HIDDEN_SECTION.test(node.title)) { hiddenLevel = node.level; continue }
      if (hiddenLevel && node.level <= hiddenLevel) hiddenLevel = 0
    }
    if (!hiddenLevel) result.push(node)
  }
  return result
}

const inlineText = (nodes: InlineNode[]) => nodes.map((node) =>
  node.type === 'link' ? `${node.label} ${node.href}` :
    node.type === 'citation' ? `[${node.number}]` :
      node.type === 'break' ? '\n' : node.value).join('')

export function reportPlainText(nodes: ReportNode[]) {
  return nodes.map((node) => {
    if (node.type === 'divider') return '---'
    if (node.type === 'heading' || node.type === 'paragraph') return inlineText(node.children)
    if (node.type === 'list') return node.items.map((item, i) => `${node.ordered ? `${i + 1}.` : '•'} ${inlineText(item)}`).join('\n')
    return [node.headers, ...node.rows].map((row) => row.map(inlineText).join(' | ')).join('\n')
  }).join('\n\n')
}
