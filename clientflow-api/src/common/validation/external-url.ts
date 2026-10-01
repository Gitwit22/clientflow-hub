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
