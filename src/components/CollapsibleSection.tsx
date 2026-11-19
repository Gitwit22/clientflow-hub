import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { UNSAVED_CHANGES_ATTRIBUTE, VALIDATION_ERROR_ATTRIBUTE } from "@/lib/section-markers";
import { cn } from "@/lib/utils";

/** Rendered by an editor while it has changes that aren't saved; a closed section says so. */
export function UnsavedChangesMarker() {
  return <span hidden {...{ [UNSAVED_CHANGES_ATTRIBUTE]: "" }} />;
}

/**
 * A section that can be opened and closed, showing a one-line summary while closed. Its content
 * stays mounted while closed (only hidden), so unsaved edits and chosen files are kept. It opens
 * itself when its content shows a validation error. Pass `open`/`onOpenChange` to control it from
 * the page (e.g. to open it from a link); otherwise it keeps its own state.
 */
export function CollapsibleSection({
  id,
  title,
  summary,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  variant = "card",
  className,
  children,
}: {
  /** The element id: links such as `#agreements` open and scroll to it. */
  id?: string;
  title: ReactNode;
  /** Shown under the title while the section is closed. */
  summary?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** "card" for a top-level section, "nested" for a section inside another. */
  variant?: "card" | "nested";
  className?: string;
  children: ReactNode;
}) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = controlledOpen ?? ownOpen;
  // Kept in a ref so the error watcher below doesn't restart when the parent re-renders.
  const latest = useRef({ controlled: controlledOpen !== undefined, onOpenChange });
  latest.current = { controlled: controlledOpen !== undefined, onOpenChange };
  const setOpen = useCallback((next: boolean) => {
    if (!latest.current.controlled) setOwnOpen(next);
    latest.current.onOpenChange?.(next);
  }, []);
  const contentId = `${useId()}-content`;
  const content = useRef<HTMLDivElement>(null);
  const [hasError, setHasError] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);

  // Open when a validation error appears inside (also inside a nested section).
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const element = content.current;
    if (!element || typeof MutationObserver === "undefined") return;
    const check = () => {
      const found = Boolean(element.querySelector(`[${VALIDATION_ERROR_ATTRIBUTE}]`));
      setHasError(found);
      setHasUnsaved(Boolean(element.querySelector(`[${UNSAVED_CHANGES_ATTRIBUTE}]`)));
      if (found && !openRef.current) setOpen(true);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [VALIDATION_ERROR_ATTRIBUTE, UNSAVED_CHANGES_ATTRIBUTE],
    });
    return () => observer.disconnect();
  }, [setOpen]);

  const Heading = variant === "card" ? "h2" : "h3";
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-4",
        variant === "card"
          ? "rounded-xl border bg-card text-card-foreground shadow shadow-card"
          : "rounded-lg border border-border",
        className,
      )}
    >
      <Heading className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen(!open)}
          className={cn(
            "flex w-full items-start gap-2 rounded-[inherit] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            variant === "card" ? "p-6" : "p-3",
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0 flex-1 space-y-1">
            <span
              className={cn(
                "block",
                variant === "card"
                  ? "font-display text-base font-semibold leading-none"
                  : "text-sm font-medium",
              )}
            >
              {title}
            </span>
            {!open && (summary || hasError || hasUnsaved) && (
              <span className="block text-xs font-normal text-muted-foreground">
                {hasError ? <span className="text-destructive">Needs fixing. </span> : null}
                {hasUnsaved ? (
                  <span className="font-medium text-foreground">Unsaved changes. </span>
                ) : null}
                {summary}
              </span>
            )}
          </span>
        </button>
      </Heading>
      <div
        id={contentId}
        ref={content}
        hidden={!open}
        className={variant === "card" ? "px-6 pb-6" : "px-3 pb-3"}
      >
        {children}
      </div>
    </section>
  );
}
