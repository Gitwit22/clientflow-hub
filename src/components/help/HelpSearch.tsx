import { useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CircleHelp, Search } from "lucide-react";
import { searchHelp } from "@/lib/help-content";
import { cn } from "@/lib/utils";

const MAX_SUGGESTIONS = 6;

/**
 * "Search help" in the top bar: type a subject, pick a suggested topic, and the Help guide opens
 * at that topic. The last option shows every matching topic on the Help page.
 */
export function HelpSearch({ className }: { className?: string }) {
  const navigate = useNavigate();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const trimmed = query.trim();
  const topics = useMemo(
    () => (trimmed ? searchHelp(trimmed).slice(0, MAX_SUGGESTIONS) : []),
    [trimmed],
  );
  // The topics, then "See all help results".
  const optionCount = trimmed ? topics.length + 1 : 0;
  const showList = open && optionCount > 0;

  function finish() {
    setQuery("");
    setOpen(false);
    setActive(0);
    input.current?.blur();
  }

  function choose(index: number) {
    const topic = topics[index];
    if (topic) void navigate({ to: "/help", hash: topic.id });
    else void navigate({ to: "/help", search: { q: trimmed } });
    finish();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (query) setQuery("");
      else input.current?.blur();
      setOpen(false);
      return;
    }
    if (!optionCount) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((current) =>
        event.key === "ArrowDown"
          ? (current + 1) % optionCount
          : (current - 1 + optionCount) % optionCount,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    }
  }

  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label="Search help"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? optionId(active) : undefined}
        value={query}
        placeholder="Search help…"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-9 w-full min-w-0 rounded-md border border-input bg-background pl-8 pr-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Help topics"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md sm:min-w-[22rem]"
        >
          {topics.map((topic, index) => (
            <li
              key={topic.id}
              id={optionId(index)}
              role="option"
              aria-selected={active === index}
              // Keep focus in the box so the click isn't lost to the blur that closes the list.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
              className={cn(
                "cursor-pointer rounded px-2 py-1.5",
                active === index && "bg-accent text-accent-foreground",
              )}
            >
              <span className="block text-sm font-medium">{topic.title}</span>
              <span className="block text-xs text-muted-foreground">
                {topic.area} · {topic.summary}
              </span>
            </li>
          ))}
          <li
            id={optionId(topics.length)}
            role="option"
            aria-selected={active === topics.length}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(topics.length)}
            onClick={() => choose(topics.length)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm",
              topics.length > 0 && "mt-1 border-t pt-2",
              active === topics.length && "bg-accent text-accent-foreground",
            )}
          >
            <CircleHelp aria-hidden className="size-4 shrink-0 text-primary" />
            {topics.length
              ? `See all help results for “${trimmed}”`
              : `No topics match “${trimmed}”. Open the Help guide`}
          </li>
        </ul>
      )}
    </div>
  );
}
