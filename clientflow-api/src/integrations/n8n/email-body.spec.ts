import { plainTextToEmailHtml } from './email-body';

const P = '<p style="margin:0 0 16px 0;">';

describe('plainTextToEmailHtml', () => {
  it('turns blank-line-separated blocks into paragraphs and keeps single line breaks', () => {
    const body = 'Good Afternoon John:\r\n\r\nYour membership payment has been received.\nWelcome to IDI!\n\n\n  EAM-Team "Inspire to be Great"  \n';
    expect(plainTextToEmailHtml(body)).toBe(
      `${P}Good Afternoon John:</p>`
      + `${P}Your membership payment has been received.<br>Welcome to IDI!</p>`
      + `${P}EAM-Team &quot;Inspire to be Great&quot;</p>`,
    );
  });

  it('escapes text so a client name can never inject markup', () => {
    expect(plainTextToEmailHtml('Hi <script>x</script> & co')).toBe(`${P}Hi &lt;script&gt;x&lt;/script&gt; &amp; co</p>`);
  });

  it('passes a body that is already HTML through unchanged', () => {
    const html = '<p>Hello</p><p>World</p>';
    expect(plainTextToEmailHtml(html)).toBe(html);
  });

  it('returns an empty string for an empty body', () => {
    expect(plainTextToEmailHtml('  \n\n ')).toBe('');
  });
});
