import { useCallback, useMemo, useState } from "react";

/**
 * Which collapsible sections of a page are open. Several can be open at once. `reveal` opens a
 * section together with the sections it sits inside (from `parents`) and scrolls to it, for links
 * such as a setup-checklist item or an address ending in `#agreements`.
 */
export function useOpenSections(parents: Readonly<Record<string, string>> = {}) {
  const [open, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());

  const setOpen = useCallback((id: string, value: boolean) => {
    setOpenIds((current) => {
      if (current.has(id) === value) return current;
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const reveal = useCallback(
    (id: string) => {
      const chain: string[] = [];
      for (let section: string | undefined = id; section; section = parents[section]) {
        chain.push(section);
      }
      setOpenIds((current) =>
        chain.every((section) => current.has(section)) ? current : new Set([...current, ...chain]),
      );
      if (typeof window === "undefined") return;
      // Scroll once the opened sections have been laid out.
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() =>
          document.getElementById(id)?.scrollIntoView({ block: "start" }),
        ),
      );
    },
    [parents],
  );

  /** Props for a controlled CollapsibleSection with this id. */
  const sectionProps = useCallback(
    (id: string) => ({
      id,
      open: open.has(id),
      onOpenChange: (value: boolean) => setOpen(id, value),
    }),
    [open, setOpen],
  );

  return useMemo(
    () => ({ isOpen: (id: string) => open.has(id), setOpen, reveal, sectionProps }),
    [open, setOpen, reveal, sectionProps],
  );
}
