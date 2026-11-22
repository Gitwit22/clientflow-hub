import type { TextEdit } from "@/lib/email-format";

/** Text sizes the agreement editor offers, and the line prefix each one writes. */
export type AgreementSize = "heading" | "subheading" | "normal" | "small";

const SIZE_PREFIX: Record<AgreementSize, string> = {
  heading: "# ",
  subheading: "## ",
  normal: "",
  small: "-# ",
};
const ANY_SIZE_PREFIX = /^(## |-# |# )/;

function selectedLines(edit: TextEdit) {
  const { value, selectionStart, selectionEnd } = edit;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const nextBreak = value.indexOf("\n", selectionEnd);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  return { lineStart, lineEnd, lines: value.slice(lineStart, lineEnd).split("\n") };
}

function replaceLines(edit: TextEdit, change: (line: string) => string): TextEdit {
  const { lineStart, lineEnd, lines } = selectedLines(edit);
  const changed = lines.map(change).join("\n");
  const collapsed = edit.selectionStart === edit.selectionEnd;
  return {
    value: `${edit.value.slice(0, lineStart)}${changed}${edit.value.slice(lineEnd)}`,
    selectionStart: collapsed ? lineStart + changed.length : lineStart,
    selectionEnd: lineStart + changed.length,
  };
}

/** The size of the line the caret is on, for the toolbar's size menu. */
export function currentLineSize(edit: TextEdit): AgreementSize {
  const { lines } = selectedLines({ ...edit, selectionEnd: edit.selectionStart });
  const prefix = ANY_SIZE_PREFIX.exec(lines[0] ?? "")?.[1];
  if (prefix === "# ") return "heading";
  if (prefix === "## ") return "subheading";
  if (prefix === "-# ") return "small";
  return "normal";
}

/** Sets the text size of the selected lines (or the current line); "normal" removes the size. */
export function setLineSize(edit: TextEdit, size: AgreementSize): TextEdit {
  return replaceLines(edit, (line) => {
    if (!line.trim()) return line;
    // A list marker goes: sized lines are not list items.
    const text = line.replace(ANY_SIZE_PREFIX, "").replace(/^\s*(?:[-•]|\d{1,3}[.)])\s+/, "");
    return `${SIZE_PREFIX[size]}${size === "normal" ? line.replace(ANY_SIZE_PREFIX, "") : text}`;
  });
}

/** Centers the selected lines (or the current line), or un-centers them when all are centered. */
export function toggleCenter(edit: TextEdit): TextEdit {
  const { lines } = selectedLines(edit);
  const isCentered = (line: string) => {
    const text = line.replace(ANY_SIZE_PREFIX, "").trim();
    return text.startsWith("->") && text.endsWith("<-");
  };
  const allCentered =
    lines.some((line) => line.trim()) && lines.every((line) => !line.trim() || isCentered(line));
  return replaceLines(edit, (line) => {
    if (!line.trim()) return line;
    const prefix = ANY_SIZE_PREFIX.exec(line)?.[1] ?? "";
    const text = line.slice(prefix.length).trim();
    if (allCentered) return `${prefix}${text.slice(2, -2).trim()}`;
    return isCentered(line) ? line : `${prefix}->${text}<-`;
  });
}
