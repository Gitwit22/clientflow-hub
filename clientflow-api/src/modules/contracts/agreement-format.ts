/**
 * Agreement formatting: the light markup staff use in agreement text, and the one parser that
 * the editor preview, the signing page and the signed PDF all read.
 *
 * KEEP IN STEP: this file is copied byte for byte to
 * clientflow-api/src/modules/contracts/agreement-format.ts (a test fails if they differ).
 *
 * Markup (the editor's toolbar inserts it; it can also be typed):
 *   **bold**   _italic_   ++underline++
 *   "# " heading   "## " subheading   "-# " small print     (at the start of a line)
 *   "- " or "• " bulleted item   "1. " numbered item      (at the start of a line)
 *   ->centered line<-   (combines with sizes: "# ->Title<-")
 *   A backslash shows the next character as it is: \* \_ \+ \# \- \< \> \\
 * An ALL-CAPS line is a heading, as agreements written before formatting existed expect.
 * Plain text without markup shows exactly as typed, so older agreements are unchanged.
 */

export type AgreementBlockKind =
  "heading" | "subheading" | "small" | "paragraph" | "bullet" | "numbered" | "blank";

export interface AgreementRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface AgreementBlock {
  kind: AgreementBlockKind;
  center: boolean;
  runs: AgreementRun[];
  /** For a numbered item: the number as typed ("3."). */
  marker?: string;
}

type Style = Pick<AgreementRun, "bold" | "italic" | "underline">;

const ESCAPABLE = "\\*_+#-<>•";
// Private-use characters stand in for escaped characters while the markup is read.
const PLACEHOLDER_BASE = 0xe100;

function protectEscapes(text: string): string {
  return text.replace(/\\([\\*_+#\-<>•])/g, (_match, char: string) =>
    String.fromCharCode(PLACEHOLDER_BASE + ESCAPABLE.indexOf(char)),
  );
}

function restoreEscapes(text: string): string {
  return text.replace(/[-]/g, (char) => ESCAPABLE.charAt(char.charCodeAt(0) - PLACEHOLDER_BASE));
}

// Each marker must wrap something other than spaces or its own marker characters, so blanks
// such as "______" or "****" stay as typed. Group 1 is what must come before the marker (kept as
// text); group 2 is the formatted text. No lookbehind, so older Safari can read the page.
const INLINE_RULES: Array<{ style: keyof Style; pattern: RegExp }> = [
  { style: "bold", pattern: /()\*\*(?=[^\s*])([\s\S]*?[^\s*])\*\*/ },
  { style: "underline", pattern: /()\+\+(?=[^\s+])([\s\S]*?[^\s+])\+\+/ },
  {
    style: "italic",
    pattern: /(^|[\s(*+"'])_(?=[^\s_])([^_\n]*?[^\s_])_(?=$|[\s).,!?:;*+"'])/,
  },
];

function inlineRuns(text: string, style: Style): AgreementRun[] {
  if (!text) return [];
  let first: { style: keyof Style; index: number; length: number; inner: string } | null = null;
  for (const rule of INLINE_RULES) {
    if (style[rule.style]) continue;
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const index = match.index + match[1].length;
    if (!first || index < first.index) {
      first = {
        style: rule.style,
        index,
        length: match[0].length - match[1].length,
        inner: match[2],
      };
    }
  }
  if (!first) return [{ text: restoreEscapes(text), ...style }];
  return [
    ...inlineRuns(text.slice(0, first.index), style),
    ...inlineRuns(first.inner, { ...style, [first.style]: true }),
    ...inlineRuns(text.slice(first.index + first.length), style),
  ];
}

function sameStyle(a: AgreementRun, b: AgreementRun): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline)
  );
}

/** Inline markup (bold, italic, underline) in one line of text, as styled pieces. */
export function parseInline(text: string): AgreementRun[] {
  const runs: AgreementRun[] = [];
  for (const run of inlineRuns(protectEscapes(text), {})) {
    const clean: AgreementRun = { text: run.text };
    if (run.bold) clean.bold = true;
    if (run.italic) clean.italic = true;
    if (run.underline) clean.underline = true;
    const previous = runs[runs.length - 1];
    if (previous && sameStyle(previous, clean)) previous.text += clean.text;
    else if (clean.text) runs.push(clean);
  }
  return runs;
}

/** An all-caps line ("1. PURPOSE", "SIGNED FOR THE ORGANIZATION"): a heading in older agreements. */
export function isAllCapsHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 90) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && letters === letters.toUpperCase();
}

const SIZE_PREFIXES: Array<[string, AgreementBlockKind]> = [
  ["## ", "subheading"],
  ["-# ", "small"],
  ["# ", "heading"],
];

/** One line of agreement text as a block. */
export function parseAgreementLine(rawLine: string): AgreementBlock {
  const line = rawLine.replace(/\s+$/, "");
  if (!line.trim()) return { kind: "blank", center: false, runs: [] };
  let kind: AgreementBlockKind = "paragraph";
  let rest = line;
  let marker: string | undefined;
  let sized = false;
  for (const [prefix, size] of SIZE_PREFIXES) {
    if (rest.startsWith(prefix)) {
      kind = size;
      rest = rest.slice(prefix.length);
      sized = true;
      break;
    }
  }
  let center = false;
  const trimmed = rest.trim();
  if (trimmed.length > 4 && trimmed.startsWith("->") && trimmed.endsWith("<-")) {
    center = true;
    rest = trimmed.slice(2, -2).trim();
  }
  if (!sized) {
    const bullet = /^\s*[-•]\s+(?=\S)/.exec(rest);
    const numbered = /^\s*(\d{1,3}[.)])\s+(?=\S)/.exec(rest);
    if (bullet) {
      kind = "bullet";
      rest = rest.slice(bullet[0].length);
    } else if (numbered) {
      kind = "numbered";
      marker = numbered[1];
      rest = rest.slice(numbered[0].length);
    }
  }
  if (kind === "paragraph" && isAllCapsHeading(rest)) kind = "subheading";
  // A numbered all-caps line ("1. PURPOSE") is a section heading, not a list item.
  if (kind === "numbered" && isAllCapsHeading(rest)) {
    kind = "subheading";
    rest = `${marker} ${rest}`;
    marker = undefined;
  }
  const block: AgreementBlock = { kind, center, runs: parseInline(rest) };
  if (marker) block.marker = marker;
  return block;
}

/** The whole agreement as blocks, one per line (blank lines kept, for spacing). */
export function parseAgreementText(text: string): AgreementBlock[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map(parseAgreementLine);
}

/** The agreement as plain text without markup, e.g. for search or a text-only copy. */
export function agreementPlainText(text: string): string {
  return parseAgreementText(text)
    .map((block) => {
      const words = block.runs.map((run) => run.text).join("");
      if (block.kind === "bullet") return `• ${words}`;
      if (block.kind === "numbered") return `${block.marker} ${words}`;
      return words;
    })
    .join("\n");
}

/**
 * A value inserted into agreement text (a client's name, an amount) is shown exactly as it is:
 * characters that would start formatting are escaped.
 */
export function escapeAgreementText(value: string): string {
  return value
    .replace(/[\\*_+#]/g, (char) => `\\${char}`)
    .replace(/->/g, "-\\>")
    .replace(/<-/g, "<\\-");
}

/** Formatting that was opened but not closed, so staff can fix it before saving. */
export function formattingProblems(text: string): string[] {
  const problems: string[] = [];
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((rawLine, index) => {
      const line = protectEscapes(rawLine);
      const lineNumber = index + 1;
      const count = (pattern: RegExp) => (line.match(pattern) ?? []).length;
      if (count(/\*\*/g) % 2 === 1)
        problems.push(`Bold text on line ${lineNumber} isn't closed with **.`);
      if (count(/\+\+/g) % 2 === 1) {
        problems.push(`Underlined text on line ${lineNumber} isn't closed with ++.`);
      }
      const trimmed = line.replace(/^(## |-# |# )/, "").trim();
      const opens = trimmed.startsWith("->");
      const closes = trimmed.endsWith("<-");
      if (opens !== closes) {
        problems.push(`The centered line ${lineNumber} needs -> at the start and <- at the end.`);
      }
    });
  return problems;
}
