import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toExternalUrl } from "@/lib/external-links";
import {
  detectPlatform,
  handleForInput,
  looksLikeLink,
  OTHER_PLATFORM,
  platformById,
  SOCIAL_PLATFORMS,
  socialUrl,
} from "@/lib/social-platforms";

const SOCIAL_SITES: Record<string, { prefix: string; baseUrl: string; hosts: string[] }> = {
  facebookUrl: {
    prefix: "facebook.com/",
    baseUrl: "https://facebook.com/",
    hosts: ["facebook.com", "fb.com"],
  },
  instagramUrl: {
    prefix: "instagram.com/",
    baseUrl: "https://instagram.com/",
    hosts: ["instagram.com"],
  },
  linkedinUrl: {
    prefix: "linkedin.com/",
    baseUrl: "https://linkedin.com/",
    hosts: ["linkedin.com"],
  },
  tiktokUrl: {
    prefix: "tiktok.com/@",
    baseUrl: "https://tiktok.com/@",
    hosts: ["tiktok.com"],
  },
  youtubeUrl: {
    prefix: "youtube.com/@",
    baseUrl: "https://youtube.com/@",
    hosts: ["youtube.com", "youtu.be"],
  },
};

export function findSocialLink(fieldId: string, links?: string[]): string {
  const site = SOCIAL_SITES[fieldId];
  if (!site) return "";
  return links?.find((link) => site.hosts.some((host) => link.toLowerCase().includes(host))) ?? "";
}

function getEntry(fieldId: string, value: string): string {
  const site = SOCIAL_SITES[fieldId];
  if (!site || !value) return value;

  const withoutProtocol = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "");
  const matchedHost = site.hosts.find((host) => withoutProtocol.toLowerCase().startsWith(host));
  const path = matchedHost
    ? withoutProtocol.slice(matchedHost.length).replace(/^\//, "")
    : withoutProtocol;
  const expectedPrefix = new URL(site.baseUrl).pathname.replace(/^\//, "");
  const withoutExpectedPrefix =
    expectedPrefix && path.toLowerCase().startsWith(expectedPrefix.toLowerCase())
      ? path.slice(expectedPrefix.length)
      : path;

  return withoutExpectedPrefix.replace(/^@/, "");
}

interface SocialMediaInputProps {
  fieldId: string;
  inputId: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SocialMediaInput({
  fieldId,
  inputId,
  value,
  onChange,
  disabled,
}: SocialMediaInputProps) {
  const site = SOCIAL_SITES[fieldId];
  if (!site) return null;

  const entry = getEntry(fieldId, value);

  return (
    <div className="flex h-9 w-full overflow-hidden rounded-md border border-input bg-transparent shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring">
      <span className="flex shrink-0 items-center border-r border-input bg-muted px-3 text-sm text-muted-foreground">
        {site.prefix}
      </span>
      <Input
        id={inputId}
        type="text"
        value={entry}
        onChange={(event) => {
          const nextEntry = getEntry(fieldId, event.target.value);
          onChange(nextEntry ? `${site.baseUrl}${nextEntry}` : "");
        }}
        disabled={disabled}
        placeholder="page name"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="h-full min-w-0 rounded-none border-0 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}

interface RepeatableSocialLinksInputProps {
  inputId: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

interface SocialRow {
  platform: string;
  text: string;
}

const MAX_SOCIAL_LINKS = 10;

function rowFromLink(link: string): SocialRow {
  const platform = detectPlatform(link)?.id ?? (toExternalUrl(link) ? OTHER_PLATFORM : "");
  return {
    platform,
    text: platform && platform !== OTHER_PLATFORM ? handleForInput(platform, link) : link,
  };
}

/** The stored value for a row: the profile link when one can be built, else the text as typed. */
function linkFromRow(row: SocialRow): string {
  const text = row.text.trim();
  if (!text) return "";
  return socialUrl(row.platform, text) ?? text;
}

function rowProblem(row: SocialRow): string | null {
  if (!row.text.trim() || socialUrl(row.platform, row.text)) return null;
  if (!row.platform) return "Choose which site this is.";
  if (row.platform === OTHER_PLATFORM)
    return "Paste the full link, e.g. https://linktr.ee/yourname.";
  return "Enter the page name (e.g. @yourname) or paste the link.";
}

/**
 * One row per profile: pick the site, then type the handle or paste the link. Each row is saved as
 * the full profile address, so staff can open it from the client profile.
 */
export function RepeatableSocialLinksInput({
  inputId,
  value,
  onChange,
  disabled,
}: RepeatableSocialLinksInputProps) {
  const [rows, setRows] = useState<SocialRow[]>(() =>
    value.length ? value.map(rowFromLink) : [{ platform: "", text: "" }],
  );
  const emitted = useRef<string[]>(value);

  // A new value from outside (prefill, reset) replaces the rows; our own changes don't.
  useEffect(() => {
    if (JSON.stringify(value) === JSON.stringify(emitted.current)) return;
    emitted.current = value;
    setRows(value.length ? value.map(rowFromLink) : [{ platform: "", text: "" }]);
  }, [value]);

  const update = (next: SocialRow[]) => {
    setRows(next);
    const links = next.map(linkFromRow).filter(Boolean);
    emitted.current = links;
    onChange(links);
  };

  const setRow = (index: number, row: SocialRow) =>
    update(rows.map((current, rowIndex) => (rowIndex === index ? row : current)));

  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const platform = platformById(row.platform);
        const problem = rowProblem(row);
        const textId = index === 0 ? inputId : `${inputId}-${index}`;
        return (
          <div key={index} className="space-y-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                aria-label={`Social media site ${index + 1}`}
                value={row.platform}
                onChange={(event) => setRow(index, { ...row, platform: event.target.value })}
                disabled={disabled}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-44"
              >
                <option value="">Choose site…</option>
                {SOCIAL_PLATFORMS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
                <option value={OTHER_PLATFORM}>Other link</option>
              </select>
              <div className="flex h-9 min-w-0 flex-1 overflow-hidden rounded-md border border-input bg-transparent shadow-sm focus-within:ring-1 focus-within:ring-ring">
                {platform && !looksLikeLink(row.text) && (
                  <span className="hidden shrink-0 items-center border-r border-input bg-muted px-3 text-sm text-muted-foreground sm:flex">
                    {platform.prefix}
                  </span>
                )}
                <Input
                  id={textId}
                  type="text"
                  value={row.text}
                  onChange={(event) => {
                    const text = event.target.value;
                    // Pasting a full link picks its site automatically.
                    const detected = detectPlatform(text)?.id;
                    const platformId =
                      detected ??
                      (!row.platform && toExternalUrl(text) && looksLikeLink(text)
                        ? OTHER_PLATFORM
                        : row.platform);
                    setRow(index, { platform: platformId, text });
                  }}
                  disabled={disabled}
                  placeholder={
                    platform
                      ? "yourname or paste the link"
                      : row.platform === OTHER_PLATFORM
                        ? "https://…"
                        : "@yourname or paste the link"
                  }
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={problem ? `${textId}-problem` : undefined}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="h-full min-w-0 rounded-none border-0 shadow-none focus-visible:ring-0"
                />
              </div>
              {rows.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => update(rows.filter((_, rowIndex) => rowIndex !== index))}
                  disabled={disabled}
                  aria-label={`Remove social media link ${index + 1}`}
                  title="Remove link"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            {problem && (
              <p id={`${textId}-problem`} className="text-xs text-destructive">
                {problem}
              </p>
            )}
          </div>
        );
      })}
      {rows.length < MAX_SOCIAL_LINKS && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => update([...rows, { platform: "", text: "" }])}
          disabled={disabled}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add another
        </Button>
      )}
    </div>
  );
}

export function isSocialMediaField(fieldId: string): boolean {
  return fieldId in SOCIAL_SITES;
}
