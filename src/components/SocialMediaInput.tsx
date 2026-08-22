import { Input } from "@/components/ui/input";

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
  return links?.find((link) =>
    site.hosts.some((host) => link.toLowerCase().includes(host)),
  ) ?? "";
}

function getEntry(fieldId: string, value: string): string {
  const site = SOCIAL_SITES[fieldId];
  if (!site || !value) return value;

  const withoutProtocol = value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const matchedHost = site.hosts.find((host) => withoutProtocol.toLowerCase().startsWith(host));
  const path = matchedHost
    ? withoutProtocol.slice(matchedHost.length).replace(/^\//, "")
    : withoutProtocol;
  const expectedPrefix = new URL(site.baseUrl).pathname.replace(/^\//, "");
  const withoutExpectedPrefix = expectedPrefix
    && path.toLowerCase().startsWith(expectedPrefix.toLowerCase())
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

export function isSocialMediaField(fieldId: string): boolean {
  return fieldId in SOCIAL_SITES;
}