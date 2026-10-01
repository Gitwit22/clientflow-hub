import { normalizeExternalUrl } from './external-url';

describe('normalizeExternalUrl', () => {
  it('adds https:// to bare web addresses', () => {
    expect(normalizeExternalUrl(' instagram.com/eabakery ')).toBe('https://instagram.com/eabakery');
    expect(normalizeExternalUrl('www.eabakery.com')).toBe('https://www.eabakery.com');
  });

  it('keeps everything else as typed', () => {
    expect(normalizeExternalUrl('https://x.com/eabakery')).toBe('https://x.com/eabakery');
    expect(normalizeExternalUrl('http://eabakery.com')).toBe('http://eabakery.com');
    expect(normalizeExternalUrl('@eabakery')).toBe('@eabakery');
    expect(normalizeExternalUrl('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(normalizeExternalUrl('see our page')).toBe('see our page');
    expect(normalizeExternalUrl('')).toBe('');
  });
});
