import { isOpenableUrl, normalizeExternalUrl, platformFieldUrl } from './external-url';

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

describe('isOpenableUrl / platformFieldUrl', () => {
  it('accepts only http(s) addresses', () => {
    expect(isOpenableUrl('instagram.com/eabakery')).toBe(true);
    expect(isOpenableUrl('https://eabakery.com')).toBe(true);
    expect(isOpenableUrl('@eabakery')).toBe(false);
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false);
  });

  it('turns a handle on a per-platform field into the profile link', () => {
    expect(platformFieldUrl('instagramUrl', '@eabakery')).toBe('https://instagram.com/eabakery');
    expect(platformFieldUrl('tiktokUrl', 'eabakery')).toBe('https://tiktok.com/@eabakery');
    expect(platformFieldUrl('facebookUrl', 'facebook.com/EA.Bakery')).toBe('https://facebook.com/EA.Bakery');
    expect(platformFieldUrl('instagramUrl', 'ea.bakery')).toBe('https://instagram.com/ea.bakery');
    expect(platformFieldUrl('instagramUrl', 'my bakery')).toBe('my bakery');
  });
});
