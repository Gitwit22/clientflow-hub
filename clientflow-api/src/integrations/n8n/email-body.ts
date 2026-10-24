const HTML_TAG = /<\/?(p|br|div|table|ul|ol|li|h[1-6]|strong|em|b|i|a|span)\b[^>]*>/i;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The HTML version of a plain-text email body, laid out the way staff see it in the editor: a blank
 * line starts a new paragraph and a single line break stays a line break. A body that already
 * contains HTML markup is passed through unchanged.
 */
export function plainTextToEmailHtml(body: string): string {
  if (HTML_TAG.test(body)) return body;
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 16px 0;">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g;
const BOLD = /\*\*(?=\S)([^*\n]*?\S)\*\*/g;
const ITALIC = /(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=$|[\s).,!?:;])/g;

/** Bold, italic and links inside one line of text; everything else is escaped. */
function inlineHtml(text: string): string {
  const links: string[] = [];
  // Links come out first so an underscore or asterisk in a web address is never read as formatting.
  const withoutLinks = text.replace(LINK, (_match, label: string, url: string) => {
    links.push(`<a href="${escapeHtml(url)}" style="color:#1d4ed8;text-decoration:underline;">${escapeHtml(label)}</a>`);
    return `\uE000${links.length - 1}\uE000`;
  });
  return escapeHtml(withoutLinks)
    .replace(BOLD, '<strong>$1</strong>')
    .replace(ITALIC, '$1<em>$2</em>')
    .replace(/\uE000(\d+)\uE000/g, (_match, index: string) => links[Number(index)] ?? '');
}

function inlineText(text: string): string {
  return text
    .replace(LINK, (_match, label: string, url: string) => (label === url ? url : `${label} (${url.replace(/^mailto:/, '')})`))
    .replace(BOLD, '$1')
    .replace(ITALIC, '$1$2');
}

type Line = { kind: 'text' | 'bullet' | 'numbered'; text: string };

function blocksOf(body: string): Line[][] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.trim())
        .map((line): Line => {
          const bullet = BULLET.exec(line);
          if (bullet) return { kind: 'bullet', text: bullet[1] };
          const numbered = NUMBERED.exec(line);
          if (numbered) return { kind: 'numbered', text: numbered[1] };
          return { kind: 'text', text: line.trim() };
        }),
    )
    .filter((lines) => lines.length > 0);
}

/**
 * A staff-written email with light formatting, as the email's HTML and plain-text versions:
 * **bold**, _italic_, [link text](https://…), lines starting "- " (bulleted list) or "1. "
 * (numbered list), a blank line between paragraphs. Everything else is escaped, so the text can
 * never inject markup.
 */
export function formattedTextToEmail(body: string): { html: string; text: string } {
  const html: string[] = [];
  const text: string[] = [];
  for (const lines of blocksOf(body)) {
    const blockText: string[] = [];
    for (let index = 0; index < lines.length; ) {
      const kind = lines[index].kind;
      const run: Line[] = [];
      while (index < lines.length && lines[index].kind === kind) run.push(lines[index++]);
      if (kind === 'text') {
        html.push(`<p style="margin:0 0 16px 0;">${run.map((line) => inlineHtml(line.text)).join('<br>')}</p>`);
        blockText.push(...run.map((line) => inlineText(line.text)));
      } else {
        const tag = kind === 'bullet' ? 'ul' : 'ol';
        html.push(
          `<${tag} style="margin:0 0 16px 0;padding-left:24px;">${run
            .map((line) => `<li style="margin:0 0 4px 0;">${inlineHtml(line.text)}</li>`)
            .join('')}</${tag}>`,
        );
        blockText.push(...run.map((line, at) => `${kind === 'bullet' ? '•' : `${at + 1}.`} ${inlineText(line.text)}`));
      }
    }
    text.push(blockText.join('\n'));
  }
  return { html: html.join(''), text: text.join('\n\n') };
}

/** The sender name n8n's Gmail nodes use for every ClientFlow email. */
export const EMAIL_SENDER_NAME = 'EA Management LLC';

/**
 * The whole email as n8n's welcome branch ("WELCOME - Prepare Email", also used for program
 * emails) builds it: the Settings logo (or a text header when there is none), the message, then
 * the sign-off. Used to preview an email exactly as members will receive it; keep it in step with
 * that n8n node.
 */
export function emailDocumentHtml(bodyHtml: string, headerImageUrl?: string | null): string {
  const header = headerImageUrl
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;"><tr><td align="center" style="padding-bottom:24px;">'
      + `<img src="${escapeHtml(headerImageUrl)}" alt="EA Management" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;">`
      + '</td></tr></table>'
    : '<div style="text-align:center;margin-bottom:24px;font-weight:bold;font-size:20px;letter-spacing:1px;color:#1a202c;">EA MANAGEMENT</div>';
  return '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333333;line-height:1.6;font-size:15px;">'
    + `${header}${bodyHtml}<p>Thank you,<br/>${EMAIL_SENDER_NAME}</p></body></html>`;
}
