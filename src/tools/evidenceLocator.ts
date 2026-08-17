export type EvidenceMatchMode = "exact" | "layout_normalized" | "noise_normalized" | "similarity" | "read_id_range" | "line_range";

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
type NormalizedText = { value: string; chars: NormalizedChar[]; presentationOffsets: Set<number> };
type ScoredSpan = { start: number; end: number; score: number; matchedBy: EvidenceQuoteCandidate["matchedBy"] };

const IGNORED_LAYOUT_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF\u00AD]/u;
const WHITESPACE = /[\s\u00A0\u3000]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const PUNCTUATION_OR_SYMBOL = /[\p{P}\p{S}]/u;
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

function markdownPresentationOffsets(value: string): Set<number> {
  const offsets = new Set<number>();
  const emphasis = /(\*\*|__)(?=\S)([^\n]*?\S)\1/g;
  for (const match of value.matchAll(emphasis)) {
    const start = match.index;
    const markerLength = match[1]?.length ?? 0;
    if (start === undefined || markerLength === 0) continue;
    const endMarker = start + match[0].length - markerLength;
    for (let index = 0; index < markerLength; index += 1) {
      offsets.add(start + index);
      offsets.add(endMarker + index);
    }
  }
  return offsets;
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
  const presentationOffsets = markdownPresentationOffsets(value);
  const output: NormalizedChar[] = [];
  let index = 0;
  while (index < source.length) {
    const current = source[index]!;
    if (isIgnored(current.value) || presentationOffsets.has(current.sourceStart)) {
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
      if (!isWhitespace(next.value) && !isIgnored(next.value) && !presentationOffsets.has(next.sourceStart)) break;
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
  return { value: output.map((item) => item.value).join(""), chars: output, presentationOffsets };
}

export function decodeMatchEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

/** Remove markdown inline-link markup by keeping only the visible label text. */
function stripMarkdownLinks(layout: NormalizedText): NormalizedText {
  const source = layout.chars;
  const output: NormalizedChar[] = [];
  const presentationOffsets = new Set(layout.presentationOffsets);
  const markSkipped = (item: NormalizedChar): void => {
    for (let offset = item.sourceStart; offset < item.sourceEnd; offset += 1) presentationOffsets.add(offset);
  };
  let index = 0;
  while (index < source.length) {
    const item = source[index]!;
    if (item.value === "[") {
      let closeBracket = index + 1;
      while (closeBracket < source.length && source[closeBracket]!.value !== "]" && !isWhitespace(source[closeBracket]!.value)) closeBracket += 1;
      const paren = closeBracket < source.length && source[closeBracket]!.value === "]" ? closeBracket + 1 : -1;
      if (paren > 0 && paren < source.length && source[paren]!.value === "(") {
        let closeParen = paren + 1;
        while (closeParen < source.length && source[closeParen]!.value !== ")" && !isWhitespace(source[closeParen]!.value)) closeParen += 1;
        if (closeParen < source.length && source[closeParen]!.value === ")") {
          markSkipped(item);
          for (let cursor = index + 1; cursor < closeBracket; cursor += 1) output.push(source[cursor]!);
          for (let cursor = paren; cursor <= closeParen; cursor += 1) markSkipped(source[cursor]!);
          index = closeParen + 1;
          continue;
        }
      }
    }
    output.push(item);
    index += 1;
  }
  return { value: output.map((item) => item.value).join(""), chars: output, presentationOffsets };
}

/** Remove transport/XML/punctuation noise for matching while retaining a map to source. */
export function normalizeEvidenceNoise(value: string): NormalizedText {
  const layout = normalizeEvidenceLayout(value);
  const linked = stripMarkdownLinks(layout);
  const output: NormalizedChar[] = [];
  const presentationOffsets = new Set(linked.presentationOffsets);
  const markSkipped = (item: NormalizedChar): void => {
    for (let offset = item.sourceStart; offset < item.sourceEnd; offset += 1) presentationOffsets.add(offset);
  };
  const chars = linked.chars;
  let index = 0;
  while (index < chars.length) {
    const item = chars[index]!;
    const tagPrefix = chars.slice(index, index + 4).map((char) => char.value).join("");
    if (item.value === "<" && /^<[/!?]?[A-Za-z]/u.test(tagPrefix)) {
      let end = index;
      while (end < chars.length && chars[end]!.value !== ">") end += 1;
      if (end < chars.length) {
        for (let cursor = index; cursor <= end; cursor += 1) markSkipped(chars[cursor]!);
        index = end + 1;
        continue;
      }
    }
    if (item.value === "&") {
      let end = index;
      while (end < chars.length && chars[end]!.value !== ";" && end - index <= 16) end += 1;
      if (end < chars.length && chars[end]!.value === ";") {
        for (let cursor = index; cursor <= end; cursor += 1) markSkipped(chars[cursor]!);
        index = end + 1;
        continue;
      }
    }
    if (isWhitespace(item.value) || PUNCTUATION_OR_SYMBOL.test(item.value)) {
      markSkipped(item);
      index += 1;
      continue;
    }
    output.push(item);
    index += 1;
  }
  return { value: output.map((item) => item.value).join(""), chars: output, presentationOffsets };
}

function numericSignature(value: string): string[] {
  return (decodeMatchEntities(value).match(/\d+(?:\s*[.,·]\s*\d+)?\s*[%‰]?/gu) ?? [])
    .map((token) => token.replace(/[\s·]/gu, "").replace(/,/g, ".").replace(/[%‰]$/u, ""));
}

function digitsOnly(value: string): string {
  return value.replace(/\D/gu, "");
}

function numericSignaturesAgree(source: string, attempted: string): boolean {
  return JSON.stringify(numericSignature(source)) === JSON.stringify(numericSignature(attempted));
}

/**
 * Similarity-pass numeric guard: the written pointer may drift ("5.88"
 * becomes "8.58") but only within the same token shape. A collapsed or moved
 * decimal point or an order-of-magnitude jump changes the clinical fact and
 * must stay rejected. Requires identical token counts and the same number of
 * digits per token; the decimal point is allowed to move or vanish because
 * the archived quote always comes from the source.
 */
function numericShapeAgrees(source: string, attempted: string): boolean {
  const sourceTokens = numericSignature(normalizeEvidenceExpand(normalizeEvidenceNoise(decodeMatchEntities(source))).value);
  const attemptedTokens = numericSignature(attempted);
  if (sourceTokens.length !== attemptedTokens.length) return false;
  for (let index = 0; index < sourceTokens.length; index += 1) {
    const s = sourceTokens[index]!;
    const t = attemptedTokens[index]!;
    const sourceDigits = digitsOnly(s).length;
    const attemptedDigits = digitsOnly(t).length;
    if (sourceDigits !== attemptedDigits) return false;
  }
  return true;
}

/** Spelled-out clinical acronyms folded back to their short form so anchors
 *  written by the model (e.g. "NNTH 3") can match the archived source
 *  ("... number needed to treat for an additional harmful outcome (NNTH) 3").
 *  Patterns are matched against the noise-normalized stream, where brackets,
 *  parentheses, and punctuation have already been removed. */
const EXPANDED_CLINICAL_ABBREVIATIONS: Array<{ pattern: RegExp; short: string }> = [
  { pattern: /numberneededtotreatforanadditionalbeneficialoutcome\s*NNTB/gu, short: "NNTB" },
  { pattern: /numberneededtotreatforanadditionalharmfuloutcome\s*NNTH/gu, short: "NNTH" },
];

export function normalizeEvidenceExpand(noise: NormalizedText): NormalizedText {
  const value = noise.value;
  const combined = new RegExp(EXPANDED_CLINICAL_ABBREVIATIONS.map(({ pattern }) => pattern.source).join("|"), "gu");
  const output: NormalizedChar[] = [];
  const presentationOffsets = new Set(noise.presentationOffsets);
  const markSkipped = (item: NormalizedChar): void => {
    for (let offset = item.sourceStart; offset < item.sourceEnd; offset += 1) presentationOffsets.add(offset);
  };
  let last = 0;
  for (const match of value.matchAll(combined)) {
    const start = match.index;
    if (start === undefined || start < last) continue;
    for (; last < start; last += 1) output.push(noise.chars[last]!);
    const shortMatch = match[0].match(/(NNTB|NNTH)$/u);
    if (!shortMatch) continue;
    const short = shortMatch[1];
    const tailStart = start + match[0].indexOf(short!);
    for (let cursor = start; cursor < start + match[0].length; cursor += 1) markSkipped(noise.chars[cursor]!);
    // Reuse the original short-form characters so the emitted chars stay
    // aligned with the output value (one element per character).
    for (let cursor = tailStart; cursor < tailStart + short!.length; cursor += 1) {
      const item = noise.chars[cursor];
      if (item) output.push(item);
    }
    last = start + match[0].length;
  }
  for (; last < noise.chars.length; last += 1) output.push(noise.chars[last]!);
  return { value: output.map((item) => item.value).join(""), chars: output, presentationOffsets };
}

type AnchorSpan = { start: number; end: number };

/**
 * Tolerate the model's most common anchor mistakes once a start boundary is
 * unique: (1) a repeated end marker that resolves to the first occurrence
 * after the start (e.g. "P < .001" appears several times but the nearest one
 * closes the quoted sentence); or (2) an end text nested entirely inside the
 * start text, which means the model pasted the complete quote into
 * start_text. Ambiguous starts are never auto-resolved.
 */
function tolerantAnchorLocate(source: string, startMatches: AnchorSpan[], endMatches: AnchorSpan[]): LocatedEvidenceQuote | undefined {
  if (startMatches.length !== 1 || endMatches.length === 0) return undefined;
  const start = startMatches[0]!;
  const endNested = endMatches.filter((end) => end.start >= start.start && end.end <= start.end);
  if (endNested.length > 0) {
    return locationFromOriginal(source, start.start, start.end, "noise_normalized");
  }
  const endOverlapping = endMatches.filter((end) => end.start < start.end && end.end > start.end).sort((left, right) => right.end - left.end);
  if (endOverlapping.length > 0) {
    return locationFromOriginal(source, start.start, endOverlapping[0]!.end, "noise_normalized");
  }
  const endAfter = endMatches.filter((end) => end.start >= start.end).sort((left, right) => left.start - right.start);
  if (endAfter.length > 0) {
    return locationFromOriginal(source, start.start, endAfter[0]!.end, "noise_normalized");
  }
  return undefined;
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

/**
 * Similarity pass: treat the model-written anchor as a pointer and locate the
 * source passage that best matches it. Only a uniquely matching candidate is
 * accepted, anchored inside the narrowed line window; the archived quote
 * always comes from the original source, so minor transcription drift in the
 * pointer does not corrupt the stored evidence.
 */
function fuzzyAnchorLocate(
  source: string,
  layer: NormalizedText,
  scope: { start: number; end: number },
  needles: { start: string; end: string },
): LocatedEvidenceQuote | undefined {
  const full = { start: 0, end: layer.value.length };
  const startsAt = fuzzyBestMatch(layer, needles.start, full);
  if (!startsAt) return undefined;
  const endsAt = fuzzyBestMatch(layer, needles.end, full, Math.max(0, startsAt.matchStart))
    ?? fuzzyEndInsideStart(layer, needles.end, startsAt);
  if (!endsAt) return undefined;

  const startMapped = originalSpan(layer, startsAt.matchStart, startsAt.matchStart + startsAt.length);
  const endMapped = originalSpan(layer, endsAt.matchStart, endsAt.matchStart + endsAt.length);
  if (!startMapped || !endMapped) return undefined;
  if (startMapped.start < scope.start || startMapped.start > scope.end) return undefined;
  // The reported line range is a pointer, not an exact receipt: once the start
  // anchor is uniquely inside the window, the end anchor may extend a few
  // lines past line_end when the passage continues there.
  if (endMapped.end > lineOffsetPastScope(source, scope.end)) return undefined;
  // Numbers stay guarded even in the similarity pass: minor written drift is
  // tolerated, and only the digit count per token is checked (the decimal
  // point may move or vanish without changing the clinical fact, since the
  // archived quote always comes from the source). An order-of-magnitude jump
  // (3.0 → 300) still changes the fact and stays rejected.
  if (!numericShapeAgrees(source.slice(startMapped.start, startMapped.end), needles.start)) return undefined;
  if (!numericShapeAgrees(source.slice(endMapped.start, endMapped.end), needles.end)) return undefined;

  // An end pointer that lands inside the start passage repeats the same quote.
  if (endsAt.matchStart < startsAt.matchStart + startsAt.length) {
    return locationFromOriginal(source, startMapped.start, startMapped.end, "similarity");
  }
  return locationFromOriginal(source, startMapped.start, Math.max(startMapped.end, endMapped.end), "similarity");
}

/**
 * If the end pointer cannot be located uniquely after the start, it may be a
 * short tail of the start passage itself (the model pasted one complete
 * passage into start_text and repeated its fragment as end_text). Accept the
 * end only when it uniquely matches inside the start span.
 */
function fuzzyEndInsideStart(
  layer: NormalizedText,
  needle: string,
  start: { matchStart: number; length: number },
): { matchStart: number; length: number } | undefined {
  if (!needle) return undefined;
  const hay = layer.value.slice(start.matchStart, start.matchStart + start.length);
  const maxDistance = Math.max(1, Math.min(24, Math.ceil(needle.length * 0.25)));
  const candidates: Array<{ at: number; distance: number }> = [];
  for (let offset = 0; offset + needle.length <= hay.length; offset += 1) {
    const distance = levenshtein(hay.slice(offset, offset + needle.length), needle, maxDistance);
    if (distance <= maxDistance) candidates.push({ at: offset, distance });
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((left, right) => left.distance - right.distance);
  const best = candidates[0]!;
  const rival = candidates.find((candidate) => Math.abs(candidate.at - best.at) >= needle.length);
  if (rival && rival.distance - best.distance < 1) return undefined;
  return { matchStart: start.matchStart + best.at, length: needle.length };
}

/**
 * Find the unique approximate occurrence of a normalized needle inside the
 * normalized source layer. Exact matching was already exhausted, so a small
 * mis-transcription is tolerated: the best candidate must be close enough
 * (Levenshtein distance within 25% of needle length, capped at 24 edits) and
 * clearly better than any runner-up. A separate candidates list lets the
 * caller preserve the "arrived but unattributed" error semantics for
 * ambiguous cases.
 */
export function fuzzyBestMatch(
  layer: NormalizedText,
  needle: string,
  scope: { start: number; end: number },
  afterMatchStart = scope.start,
): { matchStart: number; length: number } | undefined {
  const hay = layer.value;
  if (!needle || !hay || needle.length < 4) return undefined;
  const maxDistance = Math.max(1, Math.min(24, Math.ceil(needle.length * 0.25)));
  // Equal-length window comparison: the model's transcription usually has the
  // same length as the source passage, so compare the needle against a window
  // of exactly needle.length starting at each position. Levenshtein then
  // absorbs substitutions and slight shifts; longer drift fails safely.
  const candidates: Array<{ matchStart: number; length: number; distance: number }> = [];
  for (let start = afterMatchStart; start + needle.length <= hay.length; start += 1) {
    const span = hay.slice(start, start + needle.length);
    const distance = levenshtein(span, needle, maxDistance);
    if (distance > maxDistance) continue;
    candidates.push({ matchStart: start, length: needle.length, distance });
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((left, right) => left.distance - right.distance);
  // Adjacent sliding windows of the same passage produce nearly identical
  // scores; merge any windows that overlap the best one into a single cluster.
  const best = candidates[0]!;
  let rival: typeof best | undefined;
  for (const candidate of candidates) {
    if (candidate === best) continue;
    const overlap = Math.max(
      0,
      Math.min(best.matchStart + best.length, candidate.matchStart + candidate.length)
        - Math.max(best.matchStart, candidate.matchStart),
    );
    if (overlap > candidate.length * 0.5) continue;
    rival = candidate;
    break;
  }
  if (!rival) return best;
  // The best candidate must be clearly more similar than any non-overlapping
  // rival to be trustworthy as a unique pointer; otherwise it is ambiguous.
  if (rival.distance - best.distance < 1) return undefined;
  return best;
}

/** Bounded Levenshtein distance with early exit once maxDistance is exceeded. */
function levenshtein(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      if (current[j]! < rowMin) rowMin = current[j]!;
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j]!;
  }
  return previous[b.length]!;
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}

function locationFromOriginal(source: string, charStart: number, charEnd: number, matchMode: EvidenceMatchMode): LocatedEvidenceQuote {
  while (charStart < charEnd && /\s/u.test(source[charStart]!)) charStart += 1;
  while (charEnd > charStart && /\s/u.test(source[charEnd - 1]!)) charEnd -= 1;
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

function spansWithinScope(spans: ScoredSpan[], scope: { start: number; end: number }): ScoredSpan[] {
  return spans.filter((span) => span.start >= scope.start && span.end <= scope.end);
}

function formatLineRange(candidate: EvidenceQuoteCandidate): string {
  return candidate.lineStart === candidate.lineEnd
    ? `第 ${candidate.lineStart} 行`
    : `第 ${candidate.lineStart}–${candidate.lineEnd} 行`;
}

function formatCandidates(candidates: EvidenceQuoteCandidate[]): string {
  return candidates.map((candidate, index) => [
    `候选 ${index + 1} · ${formatLineRange(candidate)}`,
    candidate.quote.length > 800 ? `${candidate.quote.slice(0, 800)}…` : candidate.quote,
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

/** Legacy full-quote recovery used only by the non-model programmatic API. */
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

function lineScope(source: string, lineStart?: number, lineEnd?: number): { start: number; end: number } {
  if (lineStart === undefined && lineEnd === undefined) return { start: 0, end: source.length };
  if (lineStart === undefined || lineEnd === undefined || !Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 1 || lineEnd < lineStart) {
    throw new Error("line_start and line_end must be provided together as a valid 1-based range");
  }
  const lines = source.split("\n");
  if (lineStart > lines.length) throw new Error(`line_start ${lineStart} is beyond the archived source`);
  const start = lines.slice(0, lineStart - 1).reduce((offset, line) => offset + line.length + 1, 0);
  const end = lines.slice(0, Math.min(lineEnd, lines.length)).reduce((offset, line) => offset + line.length + 1, 0);
  return { start, end: Math.min(source.length, end) };
}

/** Offset at the start of the given 1-based line (0 if line is 1). */
function lineOffsetAt(lines: string[], line: number): number {
  return lines.slice(0, Math.max(0, line - 1)).reduce((offset, item) => offset + item.length + 1, 0);
}

/** Widen a line-window scope by a few lines for the similarity pass. */
function fuzzyScope(source: string, scope: { start: number; end: number }): { start: number; end: number } {
  if (scope.start === 0 && scope.end >= source.length - 1) return scope;
  const lines = source.split("\n");
  const startLine = Math.max(1, lineAt(source, scope.start) - 5);
  const endLine = Math.min(lines.length, lineAt(source, Math.max(scope.start, scope.end - 1)) + 5);
  return { start: lineOffsetAt(lines, startLine), end: Math.min(source.length, lineOffsetAt(lines, endLine + 1)) };
}

/** End offset up to which the similarity end anchor may extend past the scope. */
function lineOffsetPastScope(source: string, scopeEnd: number): number {
  const lines = source.split("\n");
  const endLine = Math.min(lines.length, lineAt(source, Math.max(0, scopeEnd - 1)) + 15);
  return lineOffsetAt(lines, endLine + 1);
}

/**
 * Locate a quote using exact beginning/end text anchors inside a bounded read
 * result or source line range. It tolerates layout-only differences such as
 * read-view line wrapping, while refusing to repair clinical wording.
 */
export function locateEvidenceAnchors(
  source: string,
  startText: string,
  endText: string,
  options: { lineStart?: number; lineEnd?: number; widenLineWindow?: boolean } = {},
): LocatedEvidenceQuote {
  const startNeedle = startText.trim();
  const endNeedle = endText.trim();
  if (!startNeedle || !endNeedle) throw new Error("start_text and end_text are required");
  const scope = lineScope(source, options.lineStart, options.lineEnd);
  const normalizedStartNeedle = normalizeEvidenceLayout(startNeedle).value;
  const normalizedEndNeedle = normalizeEvidenceLayout(endNeedle).value;

  // Models sometimes copy one complete passage into both fields. Treat that
  // as a single quote, rather than pairing the same needle as two independent
  // anchors. The latter creates artificial supersets (start at the passage,
  // end at a later occurrence) and turns a unique passage into an ambiguity.
  if (startNeedle === endNeedle || normalizedStartNeedle === normalizedEndNeedle) {
    const directMatches = occurrences(source, startNeedle)
      .filter((start) => start >= scope.start && start + startNeedle.length <= scope.end);
    if (directMatches.length === 1) {
      return locationFromOriginal(source, directMatches[0]!, directMatches[0]! + startNeedle.length, "exact");
    }
    if (directMatches.length > 1) {
      const candidates = directMatches.slice(0, 3).map((start) => candidateFromSpan(source, {
        start,
        end: start + startNeedle.length,
        score: startNeedle.length,
        matchedBy: "duplicate",
      }, 1));
      throw new EvidenceQuoteLocationError([
        `start_text/end_text 在限定范围内匹配到 ${directMatches.length} 处，无法唯一定位。`,
        formatCandidates(candidates),
      "请从目标候选的前后各取最短、唯一的连续原文边界；不需要语义完整，可以在词或句子中间结束，但不要只使用通用标签。",
      ].join("\n\n"), candidates);
    }

    const singleNeedlePasses: Array<{ source: NormalizedText; needle: string; mode: LocatedEvidenceQuote["matchMode"] }> = [
      { source: normalizeEvidenceLayout(source), needle: normalizedStartNeedle, mode: "layout_normalized" },
      { source: normalizeEvidenceNoise(source), needle: normalizeEvidenceNoise(decodeMatchEntities(startNeedle)).value, mode: "noise_normalized" },
    ];
    for (const pass of singleNeedlePasses) {
      const matches = occurrences(pass.source.value, pass.needle).flatMap((start) => {
        const mapped = originalSpan(pass.source, start, start + pass.needle.length);
        if (!mapped || mapped.start < scope.start || mapped.end > scope.end) return [];
        if (pass.mode === "noise_normalized" && !numericSignaturesAgree(source.slice(mapped.start, mapped.end), startNeedle)) return [];
        return [mapped];
      });
      if (matches.length === 1) return locationFromOriginal(source, matches[0]!.start, matches[0]!.end, pass.mode);
      if (matches.length > 1) {
        const candidates = matches.slice(0, 3).map((match) => candidateFromSpan(source, {
          ...match,
          score: pass.needle.length,
          matchedBy: "duplicate",
        }, 1));
        throw new EvidenceQuoteLocationError([
          `start_text/end_text 在限定范围内匹配到 ${matches.length} 处，无法唯一定位。`,
          formatCandidates(candidates),
          "请从目标候选的前后各取最短、唯一的连续原文边界；不需要语义完整，可以在词或句子中间结束，但不要只使用通用标签。",
        ].join("\n\n"), candidates);
      }
    }
  }

  const exactPairs = anchorPairs(source, startNeedle, endNeedle, scope);
  if (exactPairs.length === 1) return locationFromOriginal(source, exactPairs[0]!.start, exactPairs[0]!.end, "exact");

  // A read view may reflow a source line break into a space, or include
  // harmless zero-width/Markdown presentation characters. Normalize only
  // those layout artifacts and map the match back to the canonical source.
  const normalizedSource = normalizeEvidenceLayout(source);
  const normalizedStart = normalizeEvidenceLayout(startNeedle).value;
  const normalizedEnd = normalizeEvidenceLayout(endNeedle).value;
  const normalizedPairs = anchorPairsFromNormalized(normalizedSource, source, normalizedStart, normalizedEnd, scope);
  if (normalizedPairs.length === 1) return locationFromOriginal(source, normalizedPairs[0]!.start, normalizedPairs[0]!.end, "layout_normalized");

  // Last matching pass: ignore punctuation, XML tags/entities, and transport
  // whitespace, but require the numeric tokens in each boundary to remain
  // identical (3.0 ≠ 30; 1·7 == 1.7). This is a locator aid, not a rewrite.
  const noiseSource = normalizeEvidenceNoise(source);
  const noiseStart = normalizeEvidenceNoise(decodeMatchEntities(startNeedle)).value;
  const noiseEnd = normalizeEvidenceNoise(decodeMatchEntities(endNeedle)).value;
  const noisePairs = anchorPairsFromNormalized(noiseSource, source, noiseStart, noiseEnd, scope, {
    start: startNeedle,
    end: endNeedle,
  });
  if (noisePairs.length === 1) return locationFromOriginal(source, noisePairs[0]!.start, noisePairs[0]!.end, "noise_normalized");

  // Spelled-out acronym pass: fold "number needed to treat for an additional
  // harmful outcome NNTH" back into "NNTH" so model-written short anchors can
  // match the archived full wording. The numeric guard still applies.
  const expandSource = normalizeEvidenceExpand(noiseSource);
  const expandStart = normalizeEvidenceExpand(normalizeEvidenceNoise(decodeMatchEntities(startNeedle))).value;
  const expandEnd = normalizeEvidenceExpand(normalizeEvidenceNoise(decodeMatchEntities(endNeedle))).value;
  const expandPairs = anchorPairsFromNormalized(expandSource, source, expandStart, expandEnd, scope, {
    start: startNeedle,
    end: endNeedle,
  });
  if (expandPairs.length === 1) return locationFromOriginal(source, expandPairs[0]!.start, expandPairs[0]!.end, "noise_normalized");

  // Tolerate the model's most common anchor mistakes once the start boundary
  // is unique: a repeated end marker closes at its first occurrence after the
  // start, or an end text nested inside the start text means the complete
  // quote was pasted into start_text. Ambiguous starts stay an error.
  const tolerantMatches = (layer: NormalizedText, startNeedleValue: string, endNeedleValue: string) => {
    // Core spans use only the kept characters' own offsets, so trailing
    // punctuation or line breaks never push a boundary outside the line
    // range the model reported; this branch only cares about the anchors.
    const coreSpan = (matchStart: number, length: number): { start: number; end: number } | undefined => {
      const first = layer.chars[matchStart];
      const last = layer.chars[matchStart + length - 1];
      if (!first || !last) return undefined;
      return { start: first.sourceStart, end: last.sourceEnd };
    };
    const extendTrailingPunctuation = (end: number): number => {
      while (/[.,;:)%‰!?…。]/u.test(source[end] ?? "")) end += 1;
      return end;
    };
    const startMatches = occurrences(layer.value, startNeedleValue).flatMap((matchStart) => {
      const mapped = coreSpan(matchStart, startNeedleValue.length);
      if (!mapped || mapped.start < scope.start || mapped.end > scope.end) return [];
      if (!numericSignaturesAgree(source.slice(mapped.start, mapped.end), startNeedle)) return [];
      return [{ start: mapped.start, end: mapped.end }];
    });
    const endMatches = occurrences(layer.value, endNeedleValue).flatMap((matchStart) => {
      const mapped = coreSpan(matchStart, endNeedleValue.length);
      if (!mapped || mapped.start < scope.start || mapped.end > scope.end) return [];
      if (!numericSignaturesAgree(source.slice(mapped.start, mapped.end), endNeedle)) return [];
      return [{ start: mapped.start, end: extendTrailingPunctuation(mapped.end) }];
    });
    return tolerantAnchorLocate(source, startMatches, endMatches);
  };
  const foldCase = (layer: NormalizedText): NormalizedText => ({ ...layer, value: layer.value.toLowerCase() });
  const tolerant =
    tolerantMatches(expandSource, expandStart, expandEnd)
    ?? tolerantMatches(foldCase(expandSource), expandStart.toLowerCase(), expandEnd.toLowerCase())
    ?? tolerantMatches(noiseSource, noiseStart, noiseEnd)
    ?? tolerantMatches(foldCase(noiseSource), noiseStart.toLowerCase(), noiseEnd.toLowerCase());
  if (tolerant) return tolerant;

  // Similarity pass: the model's anchor is a pointer to the source, not a
  // verbatim transcription. When nothing above matched verbatim, accept a
  // high-similarity unique candidate so the archived quote still comes from
  // the original source. Only the quoted characters change; the archived
  // wording always follows the source. The line window is widened a few lines
  // when the caller allows it, because the model's reported line range is
  // itself an approximate pointer; an authoritative read_id receipt window
  // must stay exact so stale anchors cannot be rescued from nearby lines.
  const fuzzyScopeValue = options.widenLineWindow === false ? scope : fuzzyScope(source, scope);
  const fuzzy = fuzzyAnchorLocate(source, expandSource, fuzzyScopeValue, {
    start: normalizeEvidenceExpand(normalizeEvidenceNoise(decodeMatchEntities(startNeedle))).value,
    end: normalizeEvidenceExpand(normalizeEvidenceNoise(decodeMatchEntities(endNeedle))).value,
  });
  if (fuzzy) return fuzzy;

  const pairs = exactPairs.length ? exactPairs : normalizedPairs.length ? normalizedPairs : noisePairs;
  const candidates = pairs.length
    ? pairs.slice(0, 3).map((pair) => ({
    quote: source.slice(pair.start, pair.end),
    lineStart: lineAt(source, pair.start),
    lineEnd: lineAt(source, Math.max(pair.start, pair.end - 1)),
    charStart: pair.start,
    charEnd: pair.end,
    matchedBy: "boundary_anchors" as const,
    }))
    : deduplicateCandidates(source, [
      ...spansWithinScope(boundaryCandidateSpans(normalizedSource, normalizedStart), scope),
      ...spansWithinScope(boundaryCandidateSpans(normalizedSource, normalizedEnd), scope),
      ...spansWithinScope(boundaryCandidateSpans(noiseSource, noiseStart), scope),
      ...spansWithinScope(boundaryCandidateSpans(noiseSource, noiseEnd), scope),
    ]);
  if (pairs.length > 1) {
    throw new EvidenceQuoteLocationError([
      `start_text/end_text 在限定范围内匹配到 ${pairs.length} 处，无法唯一定位。`,
      ...(candidates.length ? [formatCandidates(candidates)] : []),
      "请从目标候选的前后各取最短、唯一的连续原文边界；不需要语义完整，可以在词或句子中间结束，但不要只使用通用标签。不要使用整篇来源作为证据。",
    ].join("\n\n"), candidates);
  }
  const startMatchedAny = [normalizedStart, noiseStart, expandStart].some((needle) => needle.length && occurrences(normalizedSource.value, needle).length);
  const endMatchedCount = [normalizedEnd, noiseEnd, expandEnd].reduce((count, needle) => count + (needle.length ? occurrences(normalizedSource.value, needle).length : 0), 0);
  const guidance = !startMatchedAny && endMatchedCount === 0
    ? "start_text 与 end_text 都没有逐字出现在该 read 片段中。请从 read 输出逐字复制边界，保留原文的加粗、链接和完整缩写（例如 number needed to treat for an additional harmful outcome (NNTH) 3）；不要从记忆补全结构词（例如 Patients:、Methods:）。"
    : !startMatchedAny
      ? "start_text 没有逐字出现在该 read 片段中，但 end_text 可以匹配。请从 read 输出复制 start_text 开头处的独特原文；不要从记忆补全结构词（例如 Patients:、Methods:）。"
      : endMatchedCount > 1
        ? "end_text 在片段中重复出现且过于通用，请把 end_text 换成更独特的结尾词，或补上紧随其后的独特词。"
        : "请从 read 输出复制最短、唯一、连续的原文边界后重试 evidence_add；不需要语义完整，可以在词或句子中间结束；不要改写数字、药名或措辞。";
  const detail = candidates.length
    ? [
      "未能在限定的 read 片段或行号范围内唯一定位 start_text/end_text。以下是仍然匹配到的原文候选；候选尚未登记为证据。",
      formatCandidates(candidates),
      guidance,
    ].join("\n\n")
    : `未能在限定的 read 片段或行号范围内找到 start_text/end_text。${guidance}`;
  throw new EvidenceQuoteLocationError(detail, candidates);
}

/** Archive the bounded line range when no reliable text anchors are available. */
export function locateEvidenceRange(
  source: string,
  lineStart: number,
  lineEnd: number,
  matchMode: "read_id_range" | "line_range",
): LocatedEvidenceQuote {
  const scope = lineScope(source, lineStart, lineEnd);
  let end = scope.end;
  while (end > scope.start && /\s/u.test(source[end - 1]!)) end -= 1;
  if (end <= scope.start) throw new Error("the selected source line range is empty");
  return locationFromOriginal(source, scope.start, end, matchMode);
}

type AnchorPair = { start: number; end: number };

function pairAnchorOffsets(starts: Array<{ start: number; end: number }>, ends: Array<{ start: number; end: number }>): AnchorPair[] {
  const pairs: AnchorPair[] = [];
  const seen = new Set<string>();
  for (const start of starts) {
    for (const end of ends) {
      if (end.start < start.end) continue;
      const key = `${start.start}:${end.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ start: start.start, end: end.end });
    }
  }
  return pairs;
}

function anchorPairs(source: string, startNeedle: string, endNeedle: string, scope: { start: number; end: number }): AnchorPair[] {
  const starts = occurrences(source, startNeedle)
    .map((start) => ({ start, end: start + startNeedle.length }))
    .filter((match) => match.start >= scope.start && match.end <= scope.end);
  const ends = occurrences(source, endNeedle)
    .map((start) => ({ start, end: start + endNeedle.length }))
    .filter((match) => match.start >= scope.start && match.end <= scope.end);
  return pairAnchorOffsets(starts, ends);
}

function anchorPairsFromNormalized(
  source: NormalizedText,
  originalSource: string,
  startNeedle: string,
  endNeedle: string,
  scope: { start: number; end: number },
  numericGuard?: { start: string; end: string },
): AnchorPair[] {
  const starts = occurrences(source.value, startNeedle).flatMap((start) => {
    const mapped = originalSpan(source, start, start + startNeedle.length);
    return mapped && mapped.start >= scope.start && mapped.end <= scope.end
      && (!numericGuard || numericSignaturesAgree(originalSource.slice(mapped.start, mapped.end), numericGuard.start))
      ? [{ ...mapped, normalizedStart: start, normalizedEnd: start + startNeedle.length }]
      : [];
  });
  const ends = occurrences(source.value, endNeedle).flatMap((start) => {
    const mapped = originalSpan(source, start, start + endNeedle.length);
    return mapped && mapped.start >= scope.start && mapped.end <= scope.end
      && (!numericGuard || numericSignaturesAgree(originalSource.slice(mapped.start, mapped.end), numericGuard.end))
      ? [{ ...mapped, normalizedStart: start, normalizedEnd: start + endNeedle.length }]
      : [];
  });
  const pairs: AnchorPair[] = [];
  const seen = new Set<string>();
  for (const start of starts) {
    const nested = ends.some((end) => end.start >= start.start && end.end <= start.end);
    if (nested) continue;
    for (const end of ends) {
      if (end.normalizedStart < start.normalizedEnd) continue;
      const key = `${start.start}:${end.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ start: start.start, end: end.end });
    }
  }
  return pairs;
}
