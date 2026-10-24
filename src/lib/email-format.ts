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

type Line = { kind: "text" | "bullet" | "numbered"; text: string };

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
      if (kind === "text") {
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
  const changed = lines
    .map((line, index) => {
      if (already) return line.replace(kind === "bullet" ? /^\s*[-*•]\s+/ : /^\s*\d+[.)]\s+/, "");
      const text = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
      return kind === "bullet" ? `- ${text}` : `${index + 1}. ${text}`;
    })
    .join("\n");
  return {
    value: `${value.slice(0, lineStart)}${changed}${value.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + changed.length,
  };
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
