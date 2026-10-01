const PLATFORMS: Array<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(facebook|fb)\.com$/, "Facebook"],
  [/(^|\.)linkedin\.com$/, "LinkedIn"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)(x|twitter)\.com$/, "X"],
  [/(^|\.)threads\.(net|com)$/, "Threads"],
  [/(^|\.)pinterest\.com$/, "Pinterest"],
];

const BARE_DOMAIN = /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i;

/**
 * A link a client typed (often without "https://") as a URL staff can open, or null when it isn't a
 * web address: a bare handle like "@bakery" has no site to point at, and only http(s) is allowed so
 * a stored value can never run script when clicked.
 */
export function toExternalUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value || /\s/.test(value)) return null;
  const candidate = /^https?:\/\//i.test(value)
    ? value
    : BARE_DOMAIN.test(value)
      ? `https://${value}`
      : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** "Instagram · @eabakery" for known platforms, otherwise the address without the scheme. */
export function linkLabel(href: string): string {
  const url = new URL(href);
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const platform = PLATFORMS.find(([pattern]) => pattern.test(host))?.[1];
  const path = url.pathname.replace(/\/+$/, "");
  if (platform) {
    const handle = path.split("/").filter(Boolean)[0];
    if (!handle) return platform;
    const clean = decodeURIComponent(handle).replace(/^@/, "");
    return platform === "LinkedIn" || platform === "YouTube" || platform === "Facebook"
      ? `${platform} · ${path.split("/").filter(Boolean).map(decodeURIComponent).join("/")}`
      : `${platform} · @${clean}`;
  }
  return `${host}${path}${url.search}`;
}
