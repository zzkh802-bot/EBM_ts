export type EvidenceMatchMode = "exact" | "layout_normalized";

export type LocatedEvidenceQuote = {
  quote: string;
  charStart: number;
  charEnd: number;
  lineStart: number;
  lineEnd: number;
  matchMode: EvidenceMatchMode;
};

export type EvidenceQuoteCandidate = {
  quote: string;
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
  matchedBy: "duplicate" | "boundary_anchors" | "fragment";
};

type NormalizedChar = { value: string; sourceStart: number; sourceEnd: number };
type NormalizedText = { value: string; chars: NormalizedChar[] };
type ScoredSpan = { start: number; end: number; score: number; matchedBy: EvidenceQuoteCandidate["matchedBy"] };

const IGNORED_LAYOUT_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF\u00AD]/u;
const WHITESPACE = /[\s\u00A0\u3000]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const PARAGRAPH_BREAK = "\uE000";
const EDGE_PUNCTUATION = /^[\s"'“”‘’`*_#\-–—:：;；,，.。!?！？()（）\[\]【】{}]+|[\s"'“”‘’`*_#\-–—:：;；,，.。!?！？()（）\[\]【】{}]+$/gu;

function sourceCharacters(value: string): NormalizedChar[] {
  const chars: NormalizedChar[] = [];
  let sourceOffset = 0;
  for (const character of value) {
    const sourceEnd = sourceOffset + character.length;
    chars.push({ value: character, sourceStart: sourceOffset, sourceEnd });
    sourceOffset = sourceEnd;
  }
  return chars;
}

function isIgnored(character: string): boolean {
  return IGNORED_LAYOUT_CHARACTERS.test(character);
}

function isWhitespace(character: string): boolean {
  return WHITESPACE.test(character);
}

/**
 * Normalize layout artifacts only. The function deliberately does not repair
 * punctuation, OCR substitutions, clinical numbers, spelling, or wording.
 * Every emitted character retains a mapping to the canonical archived source.
 */
export function normalizeEvidenceLayout(value: string): NormalizedText {
  const source = sourceCharacters(value);
  const output: NormalizedChar[] = [];
  let index = 0;
  while (index < source.length) {
    const current = source[index]!;
    if (isIgnored(current.value)) {
      index += 1;
      continue;
    }
    if (!isWhitespace(current.value)) {
      output.push(current);
      index += 1;
      continue;
    }

    const runStart = current.sourceStart;
    let runEnd = current.sourceEnd;
    let newlineCount = current.value === "\n" ? 1 : 0;
    let nextIndex = index + 1;
    while (nextIndex < source.length) {
      const next = source[nextIndex]!;
      if (!isWhitespace(next.value) && !isIgnored(next.value)) break;
      runEnd = next.sourceEnd;
      if (next.value === "\n") newlineCount += 1;
      nextIndex += 1;
    }
    const previousValue = output.at(-1)?.value;
    const nextValue = source[nextIndex]?.value;
    if (previousValue && nextValue) {
      if (newlineCount >= 2) output.push({ value: PARAGRAPH_BREAK, sourceStart: runStart, sourceEnd: runEnd });
      else if (!(CJK.test(previousValue) && CJK.test(nextValue))) output.push({ value: " ", sourceStart: runStart, sourceEnd: runEnd });
    }
    index = nextIndex;
  }
  return { value: output.map((item) => item.value).join(""), chars: output };
}

function occurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const found: number[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    found.push(index);
    from = index + 1;
  }
  return found;
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}

function locationFromOriginal(source: string, charStart: number, charEnd: number, matchMode: EvidenceMatchMode): LocatedEvidenceQuote {
  return {
    quote: source.slice(charStart, charEnd),
    charStart,
    charEnd,
    lineStart: lineAt(source, charStart),
    lineEnd: lineAt(source, Math.max(charStart, charEnd - 1)),
    matchMode,
  };
}

function originalSpan(normalized: NormalizedText, start: number, end: number): { start: number; end: number } | undefined {
  const first = normalized.chars[start];
  const last = normalized.chars[end - 1];
  if (!first || !last) return undefined;
  return { start: first.sourceStart, end: last.sourceEnd };
}

function lineWindow(source: string, charStart: number, charEnd: number, contextLines: number): { start: number; end: number } {
  let start = charStart;
  let remainingBefore = contextLines;
  while (start > 0) {
    start -= 1;
    if (source[start] === "\n" && --remainingBefore < 0) {
      start += 1;
      break;
    }
  }
  let end = charEnd;
  let remainingAfter = contextLines;
  while (end < source.length) {
    if (source[end] === "\n" && --remainingAfter < 0) break;
    end += 1;
  }
  return { start, end };
}

function candidateFromSpan(source: string, span: ScoredSpan, contextLines = 0): EvidenceQuoteCandidate {
  const window = lineWindow(source, span.start, span.end, contextLines);
  const raw = source.slice(window.start, window.end);
  const leadingWhitespace = raw.length - raw.trimStart().length;
  const trailingWhitespace = raw.length - raw.trimEnd().length;
  const charStart = window.start + leadingWhitespace;
  const charEnd = window.end - trailingWhitespace;
  return {
    quote: source.slice(charStart, charEnd),
    lineStart: lineAt(source, charStart),
    lineEnd: lineAt(source, Math.max(charStart, charEnd - 1)),
    charStart,
    charEnd,
    matchedBy: span.matchedBy,
  };
}

function trimAnchorText(value: string): string {
  return value.replace(EDGE_PUNCTUATION, "").trim();
}

function anchorLengths(length: number): number[] {
  return [6, 8, 12, 16, 24].filter((item) => item <= length).reverse();
}

function boundaryCandidateSpans(source: NormalizedText, attempted: string): ScoredSpan[] {
  const clean = trimAnchorText(attempted);
  if (clean.length < 6) return [];
  const spans: ScoredSpan[] = [];
  const minimumSpan = Math.max(12, Math.floor(clean.length * 0.6));
  const maximumSpan = Math.min(5_000, Math.max(clean.length * 3, clean.length + 240));
  for (const length of anchorLengths(clean.length)) {
    const first = clean.slice(0, length);
    const last = clean.slice(-length);
    for (const start of occurrences(source.value, first)) {
      for (const lastStart of occurrences(source.value, last)) {
        const end = lastStart + last.length;
        if (lastStart < start + first.length || end - start < minimumSpan || end - start > maximumSpan) continue;
        const mapped = originalSpan(source, start, end);
        if (!mapped) continue;
        const lengthDifference = Math.abs((end - start) - clean.length);
        spans.push({
          start: mapped.start,
          end: mapped.end,
          score: length * 20 - lengthDifference,
          matchedBy: "boundary_anchors",
        });
      }
    }
    if (spans.length) break;
  }
  return spans;
}

function fragmentCandidateSpans(source: NormalizedText, attempted: string): ScoredSpan[] {
  const clean = trimAnchorText(attempted);
  const spans: ScoredSpan[] = [];
  for (const length of anchorLengths(clean.length)) {
    const starts = new Set([
      0,
      Math.max(0, Math.floor((clean.length - length) / 4)),
      Math.max(0, Math.floor((clean.length - length) / 2)),
      Math.max(0, Math.floor(((clean.length - length) * 3) / 4)),
      Math.max(0, clean.length - length),
    ]);
    for (const fragmentStart of starts) {
      const fragment = clean.slice(fragmentStart, fragmentStart + length);
      for (const matchStart of occurrences(source.value, fragment)) {
        const mapped = originalSpan(source, matchStart, matchStart + fragment.length);
        if (!mapped) continue;
        const window = lineWindowFromCharacterRadius(source, mapped.start, mapped.end, clean.length);
        spans.push({ ...window, score: length * 10, matchedBy: "fragment" });
      }
    }
    if (spans.length) break;
  }
  return spans;
}

function lineWindowFromCharacterRadius(source: NormalizedText, start: number, end: number, attemptedLength: number): { start: number; end: number } {
  const radius = Math.min(800, Math.max(160, attemptedLength));
  return {
    start: Math.max(0, start - radius),
    end: Math.min(source.chars.at(-1)?.sourceEnd ?? end, end + radius),
  };
}

function deduplicateCandidates(source: string, spans: ScoredSpan[]): EvidenceQuoteCandidate[] {
  const seen = new Set<string>();
  return spans
    .sort((left, right) => right.score - left.score || left.start - right.start)
    .flatMap((span) => {
      const candidate = candidateFromSpan(source, span, span.matchedBy === "fragment" ? 1 : 0);
      const key = `${candidate.charStart}:${candidate.charEnd}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [candidate];
    })
    .slice(0, 3);
}

function formatLineRange(candidate: EvidenceQuoteCandidate): string {
  return candidate.lineStart === candidate.lineEnd
    ? `第 ${candidate.lineStart} 行`
    : `第 ${candidate.lineStart}–${candidate.lineEnd} 行`;
}

function formatCandidates(candidates: EvidenceQuoteCandidate[]): string {
  return candidates.map((candidate, index) => [
    `候选 ${index + 1} · ${formatLineRange(candidate)}`,
    candidate.quote,
  ].join("\n")).join("\n\n");
}

export class EvidenceQuoteLocationError extends Error {
  readonly candidates: EvidenceQuoteCandidate[];

  constructor(message: string, candidates: EvidenceQuoteCandidate[]) {
    super(message);
    this.name = "EvidenceQuoteLocationError";
    this.candidates = candidates;
  }
}

export function locateEvidenceQuote(source: string, attemptedQuote: string): LocatedEvidenceQuote {
  const attempted = attemptedQuote.trim();
  if (!attempted) throw new Error("quote is required");

  const exact = occurrences(source, attempted);
  if (exact.length === 1) return locationFromOriginal(source, exact[0]!, exact[0]! + attempted.length, "exact");
  if (exact.length > 1) {
    const candidates = exact.slice(0, 3).map((start) => candidateFromSpan(source, {
      start,
      end: start + attempted.length,
      score: attempted.length,
      matchedBy: "duplicate",
    }, 1));
    throw new EvidenceQuoteLocationError([
      `提交的 quote 在归档来源中匹配到 ${exact.length} 处，无法唯一定位。`,
      formatCandidates(candidates),
      "请增加能够区分这些位置的连续上下文后重试。",
    ].join("\n\n"), candidates);
  }

  const normalizedSource = normalizeEvidenceLayout(source);
  const normalizedAttempted = normalizeEvidenceLayout(attempted).value;
  const normalizedMatches = occurrences(normalizedSource.value, normalizedAttempted);
  if (normalizedMatches.length === 1) {
    const mapped = originalSpan(normalizedSource, normalizedMatches[0]!, normalizedMatches[0]! + normalizedAttempted.length);
    if (mapped) return locationFromOriginal(source, mapped.start, mapped.end, "layout_normalized");
  }
  if (normalizedMatches.length > 1) {
    const candidates = normalizedMatches.slice(0, 3).flatMap((start) => {
      const mapped = originalSpan(normalizedSource, start, start + normalizedAttempted.length);
      return mapped ? [candidateFromSpan(source, { ...mapped, score: normalizedAttempted.length, matchedBy: "duplicate" }, 1)] : [];
    });
    throw new EvidenceQuoteLocationError([
      `排版归一化后的 quote 在归档来源中匹配到 ${normalizedMatches.length} 处，无法唯一定位。`,
      formatCandidates(candidates),
      "请增加能够区分这些位置的连续上下文后重试。",
    ].join("\n\n"), candidates);
  }

  const spans = boundaryCandidateSpans(normalizedSource, normalizedAttempted);
  const fallbackSpans = spans.length ? [] : fragmentCandidateSpans(normalizedSource, normalizedAttempted);
  const candidates = deduplicateCandidates(source, [...spans, ...fallbackSpans]);
  const detail = candidates.length
    ? [
      "未能在归档来源中唯一定位提交的 quote。系统根据仍然匹配的短锚点找到了以下原文候选；候选尚未登记为证据。",
      formatCandidates(candidates),
      "请从候选中复制最小、充分、连续原文，并使用原文重试 evidence_add；不要改写数字、药名或措辞。",
    ].join("\n\n")
    : "未能在归档来源中唯一定位提交的 quote，也没有找到可靠的原文候选。请重新读取归档来源，复制最小、充分、连续原文后重试。";
  throw new EvidenceQuoteLocationError(detail, candidates);
}
