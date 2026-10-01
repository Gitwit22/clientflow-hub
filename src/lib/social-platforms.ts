import { toExternalUrl } from "./external-links";

export interface SocialPlatform {
  id: string;
  label: string;
  /** Profile URL up to the handle, e.g. "https://instagram.com/". */
  baseUrl: string;
  hosts: string[];
  /** Shown before the input, e.g. "instagram.com/". */
  prefix: string;
}

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  {
    id: "instagram",
    label: "Instagram",
    baseUrl: "https://instagram.com/",
    hosts: ["instagram.com"],
    prefix: "instagram.com/",
  },
  {
    id: "facebook",
    label: "Facebook",
    baseUrl: "https://facebook.com/",
    hosts: ["facebook.com", "fb.com"],
    prefix: "facebook.com/",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    baseUrl: "https://linkedin.com/in/",
    hosts: ["linkedin.com"],
    prefix: "linkedin.com/in/",
  },
  {
    id: "tiktok",
    label: "TikTok",
    baseUrl: "https://tiktok.com/@",
    hosts: ["tiktok.com"],
    prefix: "tiktok.com/@",
  },
  {
    id: "youtube",
    label: "YouTube",
    baseUrl: "https://youtube.com/@",
    hosts: ["youtube.com", "youtu.be"],
    prefix: "youtube.com/@",
  },
  {
    id: "x",
    label: "X (Twitter)",
    baseUrl: "https://x.com/",
    hosts: ["x.com", "twitter.com"],
    prefix: "x.com/",
  },
  {
    id: "threads",
    label: "Threads",
    baseUrl: "https://threads.net/@",
    hosts: ["threads.net", "threads.com"],
    prefix: "threads.net/@",
  },
  {
    id: "pinterest",
    label: "Pinterest",
    baseUrl: "https://pinterest.com/",
    hosts: ["pinterest.com"],
    prefix: "pinterest.com/",
  },
];

/** Typed text that is meant as a link rather than a handle. */
export function looksLikeLink(value: string): boolean {
  const text = value.trim();
  return /^https?:\/\//i.test(text) || text.includes("/") || !!detectPlatform(text);
}

/** A link that isn't on one of the platforms above (a Linktree, a second website…). */
export const OTHER_PLATFORM = "other";

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function platformById(id: string): SocialPlatform | undefined {
  return SOCIAL_PLATFORMS.find((platform) => platform.id === id);
}

/** The platform a link points at, from its address; undefined for other sites or non-links. */
export function detectPlatform(value: string): SocialPlatform | undefined {
  const url = toExternalUrl(value);
  const host = url ? hostOf(url) : null;
  if (!host) return undefined;
  return SOCIAL_PLATFORMS.find((platform) =>
    platform.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)),
  );
}

/**
 * The profile address for what someone typed for a platform: a full link (kept, with https://
 * added if missing), "instagram.com/name", "@name" or just "name". Null when nothing usable was
 * typed, so the form can ask for a fix instead of saving something that can't be opened.
 */
export function socialUrl(platformId: string, input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const asLink = toExternalUrl(value);
  if (platformId === OTHER_PLATFORM) return asLink;
  // "ea.bakery" is a handle on a platform, not a website; a link has a scheme, a path or the site.
  if (asLink && looksLikeLink(value)) return asLink;
  const platform = platformById(platformId);
  if (!platform) return null;
  const handle = value.replace(/^@+/, "");
  if (!/^[\p{L}\p{N}._-]{1,100}$/u.test(handle)) return null;
  return `${platform.baseUrl}${handle}`;
}

/** What to show in the input for a stored link: the handle for a known platform, else the link. */
export function handleForInput(platformId: string, value: string): string {
  const platform = platformById(platformId);
  const url = toExternalUrl(value);
  if (!platform || !url || detectPlatform(url)?.id !== platform.id) return value;
  const base = new URL(platform.baseUrl);
  const parsed = new URL(url);
  const basePath = base.pathname;
  if (hostOf(url) && parsed.pathname.toLowerCase().startsWith(basePath.toLowerCase())) {
    const rest = parsed.pathname.slice(basePath.length).replace(/\/+$/, "");
    if (rest && !rest.includes("/") && !parsed.search) return decodeURIComponent(rest);
  }
  return value;
}

/** Links in a social_links answer that can't be opened (shown to the person filling the form). */
export function invalidSocialLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (link): link is string => typeof link === "string" && !!link.trim() && !toExternalUrl(link),
  );
}
