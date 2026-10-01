import { ExternalLink } from "lucide-react";
import { linkLabel, toExternalUrl } from "@/lib/external-links";

/** Website / social links that open the client's page in a new tab; anything else stays text. */
export function ExternalLinks({ links }: { links: Array<string | null | undefined> }) {
  const values = links.map((link) => (link ?? "").trim()).filter(Boolean);
  if (!values.length) return <>—</>;
  return (
    <ul className="space-y-0.5">
      {values.map((value, index) => {
        const href = toExternalUrl(value);
        return (
          <li key={`${index}-${value}`} className="break-all">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                {linkLabel(href)}
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              </a>
            ) : (
              <>
                {value}
                <span className="ml-1 text-xs text-muted-foreground">
                  (not a link: choose its site in Edit client)
                </span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
