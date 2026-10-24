import { formattedTextToEmail, plainTextToEmailHtml } from './email-body';

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

describe('formattedTextToEmail', () => {
  it('renders bold, italic, links, bulleted and numbered lists, with a matching plain-text version', () => {
    const body = [
      'Hello **everyone**,',
      'Grant day is _this Saturday_.',
      '',
      'Bring:',
      '- your **business plan**',
      '* last 3 months of statements',
      '',
      '1. Arrive at 9',
      '2. Register at [our site](https://ea.example.com/sign_up?a=1&b=2)',
    ].join('\n');
    const { html, text } = formattedTextToEmail(body);
    expect(html).toBe(
      `${P}Hello <strong>everyone</strong>,<br>Grant day is <em>this Saturday</em>.</p>`
      + `${P}Bring:</p>`
      + '<ul style="margin:0 0 16px 0;padding-left:24px;"><li style="margin:0 0 4px 0;">your <strong>business plan</strong></li>'
      + '<li style="margin:0 0 4px 0;">last 3 months of statements</li></ul>'
      + '<ol style="margin:0 0 16px 0;padding-left:24px;"><li style="margin:0 0 4px 0;">Arrive at 9</li>'
      + '<li style="margin:0 0 4px 0;">Register at <a href="https://ea.example.com/sign_up?a=1&amp;b=2" style="color:#1d4ed8;text-decoration:underline;">our site</a></li></ol>',
    );
    expect(text).toBe(
      'Hello everyone,\nGrant day is this Saturday.\n\nBring:\n• your business plan\n• last 3 months of statements\n\n'
      + '1. Arrive at 9\n2. Register at our site (https://ea.example.com/sign_up?a=1&b=2)',
    );
  });

  it('escapes markup, ignores unsafe links and leaves underscores inside words alone', () => {
    const { html } = formattedTextToEmail('<b>hi</b> [x](javascript:alert(1)) snake_case_name');
    expect(html).toBe(`${P}&lt;b&gt;hi&lt;/b&gt; [x](javascript:alert(1)) snake_case_name</p>`);
  });

  it('a plain message stays plain', () => {
    expect(formattedTextToEmail('Hello all,\n\nSee you Saturday.')).toEqual({
      html: `${P}Hello all,</p>${P}See you Saturday.</p>`,
      text: 'Hello all,\n\nSee you Saturday.',
    });
  });
});
