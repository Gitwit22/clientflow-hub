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
