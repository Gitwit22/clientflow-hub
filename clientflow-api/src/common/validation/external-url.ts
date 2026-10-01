const BARE_DOMAIN = /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i;

/**
 * Stores a website or social link the way it can be opened: "instagram.com/x" becomes
 * "https://instagram.com/x". Anything that isn't a bare web address (a handle like "@x", text, or an
 * address that already has a scheme) is kept exactly as typed; the profile only links http(s).
 */
export function normalizeExternalUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /\s/.test(trimmed)) return trimmed;
  return BARE_DOMAIN.test(trimmed) ? `https://${trimmed}` : trimmed;
}

/** True when the value (after normalizing) is an http(s) address a browser can open. */
export function isOpenableUrl(value: string): boolean {
  try {
    const url = new URL(normalizeExternalUrl(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Profile address prefix for the per-platform form fields (`instagramUrl`, …). */
const PLATFORM_BASE_URLS: Record<string, string> = {
  facebookUrl: 'https://facebook.com/',
  instagramUrl: 'https://instagram.com/',
  linkedinUrl: 'https://linkedin.com/',
  tiktokUrl: 'https://tiktok.com/@',
  youtubeUrl: 'https://youtube.com/@',
};

/**
 * An answer to a per-platform field as a profile link: a pasted link is kept (with https:// added),
 * and a bare handle ("@name" or "name") becomes that platform's profile address.
 */
export function platformFieldUrl(fieldId: string, value: string): string {
  const trimmed = value.trim();
  const base = PLATFORM_BASE_URLS[fieldId];
  // "ea.bakery" on the Instagram field is a handle, not a website: only a scheme or a path makes it a link.
  if (!base || !trimmed || /^https?:\/\//i.test(trimmed) || trimmed.includes('/')) return normalizeExternalUrl(trimmed);
  const handle = trimmed.replace(/^@+/, '');
  return /^[\p{L}\p{N}._-]{1,100}$/u.test(handle) ? `${base}${handle}` : trimmed;
}
