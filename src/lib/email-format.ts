/**
 * Light formatting for staff-written emails, matching the API's `formattedTextToEmail`
 * (clientflow-api/src/integrations/n8n/email-body.ts) so the preview shows what members receive:
 * **bold**, _italic_, [link text](https://…), lines starting "- " (bulleted list) or "1. "
 * (numbered list), a blank line between paragraphs. Everything else is escaped.
 */

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g;
const BOLD = /\*\*(?=\S)([^*\n]*?\S)\*\*/g;
const ITALIC = /(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=$|[\s).,!?:;])/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineHtml(text: string): string {
  const links: string[] = [];
  const withoutLinks = text.replace(LINK, (_match, label: string, url: string) => {
    links.push(
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="underline text-primary">${escapeHtml(label)}</a>`,
    );
    return `\uE000${links.length - 1}\uE000`;
  });
  return escapeHtml(withoutLinks)
    .replace(BOLD, "<strong>$1</strong>")
    .replace(ITALIC, "$1<em>$2</em>")
    .replace(/\uE000(\d+)\uE000/g, (_match, index: string) => links[Number(index)] ?? "");
}

type Line = { kind: "text" | "bullet" | "numbered" | "image"; text: string; url?: string };

/** `![alt](https://…)` on its own line: an image (only uploaded email images are accepted to send). */
const IMAGE_LINE = /^!\[([^\]\n]*)\]\((https:\/\/[^\s)]+)\)$/;

/** The message as HTML for the in-app preview and history (escaped; safe to render). */
export function formattedEmailHtml(body: string): string {
  const html: string[] = [];
  const blocks = body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.trim())
        .map((line): Line => {
          const image = IMAGE_LINE.exec(line.trim());
          if (image) return { kind: "image", text: image[1].trim(), url: image[2] };
          const bullet = BULLET.exec(line);
          if (bullet) return { kind: "bullet", text: bullet[1] };
          const numbered = NUMBERED.exec(line);
          if (numbered) return { kind: "numbered", text: numbered[1] };
          return { kind: "text", text: line.trim() };
        }),
    );
  for (const lines of blocks) {
    for (let index = 0; index < lines.length;) {
      const kind = lines[index].kind;
      const run: Line[] = [];
      while (index < lines.length && lines[index].kind === kind) run.push(lines[index++]);
      if (kind === "image") {
        for (const line of run) {
          html.push(
            `<p><img src="${escapeHtml(line.url ?? "")}" alt="${escapeHtml(line.text)}" style="display:block;max-width:100%;height:auto;"></p>`,
          );
        }
      } else if (kind === "text") {
        html.push(`<p>${run.map((line) => inlineHtml(line.text)).join("<br>")}</p>`);
      } else {
        const tag = kind === "bullet" ? "ul" : "ol";
        html.push(
          `<${tag}>${run.map((line) => `<li>${inlineHtml(line.text)}</li>`).join("")}</${tag}>`,
        );
      }
    }
  }
  return html.join("");
}

export interface TextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Wraps the selection in a marker (bold "**", italic "_"); with no selection, inserts a placeholder. */
export function wrapSelection(edit: TextEdit, marker: string, placeholder: string): TextEdit {
  const { value, selectionStart: start, selectionEnd: end } = edit;
  const selected = value.slice(start, end) || placeholder;
  const next = `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`;
  return {
    value: next,
    selectionStart: start + marker.length,
    selectionEnd: start + marker.length + selected.length,
  };
}

/** Turns the selected lines (or the current line) into a bulleted or numbered list. */
export function toggleList(edit: TextEdit, kind: "bullet" | "numbered"): TextEdit {
  const { value, selectionStart, selectionEnd } = edit;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const nextBreak = value.indexOf("\n", selectionEnd);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const pattern = kind === "bullet" ? BULLET : NUMBERED;
  const already = lines.every((line) => !line.trim() || pattern.test(line));
  // A numbered item right after an existing numbered list continues its numbering.
  const previousLine =
    lineStart > 0 ? value.slice(value.lastIndexOf("\n", lineStart - 2) + 1, lineStart - 1) : "";
  const previousNumber = NUMBERED_ITEM.exec(previousLine)?.[2];
  const firstNumber = previousNumber ? Number(previousNumber) + 1 : 1;
  const changed = lines
    .map((line, index) => {
      if (already) return line.replace(kind === "bullet" ? /^\s*[-*•]\s+/ : /^\s*\d+[.)]\s+/, "");
      const text = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
      return kind === "bullet" ? `- ${text}` : `${firstNumber + index}. ${text}`;
    })
    .join("\n");
  return {
    value: `${value.slice(0, lineStart)}${changed}${value.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + changed.length,
  };
}

const BULLET_ITEM = /^(\s*)([-*•])(?:\s+(.*))?$/;
const NUMBERED_ITEM = /^(\s*)(\d+)([.)])(?:\s+(.*))?$/;

/**
 * Enter inside a list item: starts the next item ("- " or the next number) and renumbers the
 * numbered items after it. Enter on an empty item ends the list instead. Returns null when Enter
 * should behave normally (not on a list item, a selection, or the caret inside the marker).
 */
export function continueListOnEnter(edit: TextEdit): TextEdit | null {
  const { value, selectionStart, selectionEnd } = edit;
  if (selectionStart !== selectionEnd) return null;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const nextBreak = value.indexOf("\n", selectionStart);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const line = value.slice(lineStart, lineEnd);
  const bullet = BULLET_ITEM.exec(line);
  const numbered = bullet ? null : NUMBERED_ITEM.exec(line);
  if (!bullet && !numbered) return null;
  const itemText = (bullet ? bullet[3] : numbered![4]) ?? "";
  const markerLength = line.length - itemText.length;
  if (selectionStart - lineStart < markerLength && itemText) return null;

  if (!itemText.trim()) {
    // An empty item ends the list: the marker is removed and the line stays, empty.
    return {
      value: `${value.slice(0, lineStart)}${value.slice(lineEnd)}`,
      selectionStart: lineStart,
      selectionEnd: lineStart,
    };
  }

  const indent = (bullet ?? numbered)![1];
  const nextNumber = numbered ? Number(numbered[2]) + 1 : 0;
  const marker = bullet ? `${indent}${bullet[2]} ` : `${indent}${nextNumber}${numbered![3]} `;
  const before = value.slice(0, selectionStart);
  // Text after the caret moves to the new item, without the space that separated it.
  let after = value.slice(selectionStart).replace(/^[ \t]+/, "");
  if (numbered) after = renumberFollowing(after, indent, nextNumber + 1);
  const caret = selectionStart + 1 + marker.length;
  return { value: `${before}\n${marker}${after}`, selectionStart: caret, selectionEnd: caret };
}

/** Renumbers the numbered items directly following the current line, starting at `from`. */
function renumberFollowing(rest: string, indent: string, from: number): string {
  const lines = rest.split("\n");
  let number = from;
  for (let index = 1; index < lines.length; index += 1) {
    const item = NUMBERED_ITEM.exec(lines[index]);
    if (!item || item[1] !== indent) break;
    lines[index] = `${indent}${number}${item[3]} ${item[4] ?? ""}`;
    number += 1;
  }
  return lines.join("\n");
}

/** Inserts [text](url) around the selection. Only web and email addresses become links. */
export function insertLink(edit: TextEdit, rawUrl: string): TextEdit | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const url = /^(https?:\/\/|mailto:)/i.test(trimmed)
    ? trimmed
    : trimmed.includes("@") && !trimmed.includes("/")
      ? `mailto:${trimmed}`
      : `https://${trimmed}`;
  if (/\s/.test(url)) return null;
  const { value, selectionStart: start, selectionEnd: end } = edit;
  const label = value.slice(start, end) || trimmed;
  const inserted = `[${label}](${url})`;
  return {
    value: `${value.slice(0, start)}${inserted}${value.slice(end)}`,
    selectionStart: start + inserted.length,
    selectionEnd: start + inserted.length,
  };
}

/** Inserts an image line (on its own line, with blank lines around it) at the cursor. */
export function insertImage(edit: TextEdit, url: string, alt: string): TextEdit {
  const { value, selectionEnd: at } = edit;
  const safeAlt = alt.replace(/[[\]\n]/g, " ").trim();
  const before = value.slice(0, at);
  const after = value.slice(at);
  const lead =
    before === "" ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail =
    after === "" ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = `${lead}![${safeAlt}](${url})${trail}`;
  const caret = before.length + inserted.length;
  return { value: `${before}${inserted}${after}`, selectionStart: caret, selectionEnd: caret };
}
