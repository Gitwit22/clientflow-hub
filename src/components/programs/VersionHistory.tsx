import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A version list that keeps old versions out of the way: the active version is always shown and
 * the rest sit behind a "Show older versions" toggle. With no active version the newest shows.
 */
export function VersionHistory<T extends { id: string }>({
  versions,
  activeId,
  renderVersion,
}: {
  versions: T[];
  activeId?: string | null;
  renderVersion: (version: T) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pinned = versions.find((version) => version.id === activeId) ?? versions[0];
  const others = versions.filter((version) => version !== pinned);

  return (
    <div className="space-y-2">
      {pinned && renderVersion(pinned)}
      {others.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            {open
              ? "Hide older versions"
              : `Show ${others.length} older version${others.length === 1 ? "" : "s"}`}
          </button>
          {open && others.map((version) => renderVersion(version))}
        </>
      )}
    </div>
  );
}
