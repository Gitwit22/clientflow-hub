import { attachmentDisposition, inlineDisposition } from './storage.service';

describe('content disposition', () => {
  it('downloads under the file name, or shows it in the browser for View', () => {
    expect(attachmentDisposition('Membership Agreement.pdf')).toBe(
      `attachment; filename="Membership Agreement.pdf"; filename*=UTF-8''Membership%20Agreement.pdf`,
    );
    expect(inlineDisposition('Membership Agreement.pdf')).toBe(
      `inline; filename="Membership Agreement.pdf"; filename*=UTF-8''Membership%20Agreement.pdf`,
    );
  });

  it('keeps the header safe for quotes and non-ASCII names', () => {
    expect(inlineDisposition('Café "plan".pdf')).toBe(`inline; filename="Caf plan.pdf"; filename*=UTF-8''Caf%C3%A9%20%22plan%22.pdf`);
  });
});
