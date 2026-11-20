import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Lightbulb, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  HELP_AREAS,
  HELP_TOPICS,
  searchHelp,
  type HelpBlock,
  type HelpTopic,
} from "@/lib/help-content";
import { cn } from "@/lib/utils";

/** The topic named in the address (/help#topic-id), if it exists. */
function topicFromAddress(): string | null {
  if (typeof window === "undefined") return null;
  const id = decodeURIComponent(window.location.hash.slice(1));
  return HELP_TOPICS.some((topic) => topic.id === id) ? id : null;
}

function Block({ block }: { block: HelpBlock }) {
  if (block.type === "text") return <p className="text-sm leading-relaxed">{block.text}</p>;
  if (block.type === "tip") {
    return (
      <p className="flex gap-2 rounded-md bg-primary/5 p-3 text-sm leading-relaxed">
        <Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>{block.text}</span>
      </p>
    );
  }
  const List = block.type === "steps" ? "ol" : "ul";
  return (
    <List
      className={cn(
        "space-y-1.5 pl-5 text-sm leading-relaxed",
        block.type === "steps" ? "list-decimal" : "list-disc",
      )}
    >
      {block.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </List>
  );
}

function Topic({ topic, highlighted }: { topic: HelpTopic; highlighted: boolean }) {
  return (
    <article
      id={topic.id}
      aria-labelledby={`${topic.id}-title`}
      className={cn(
        "scroll-mt-4 space-y-3 rounded-xl border bg-card p-5 shadow-card transition-shadow",
        highlighted && "ring-2 ring-primary",
      )}
    >
      <header className="space-y-1">
        <h3 id={`${topic.id}-title`} className="font-display text-lg font-semibold">
          <a href={`#${topic.id}`} className="hover:underline">
            {topic.title}
          </a>
        </h3>
        <p className="text-sm text-muted-foreground">{topic.summary}</p>
      </header>
      {topic.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
      {topic.links?.length ? (
        <div className="flex flex-wrap gap-3 pt-1">
          {topic.links.map((link) => (
            <Link
              key={link.to + link.label}
              to={link.to}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {link.label} →
            </Link>
          ))}
        </div>
      ) : null}
    </article>
  );
}

/**
 * The staff guide: topics grouped by area, a search box, and an area list. A topic can be opened
 * directly with /help#<topic-id> (the "How this works" links on each page do this).
 */
export function HelpCenter() {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const results = useMemo(() => searchHelp(query), [query]);
  const areas = HELP_AREAS.map((area) => ({
    area,
    topics: results.filter((topic) => topic.area === area),
  })).filter((group) => group.topics.length > 0);

  // Open the topic named in the address, now and whenever it changes.
  useEffect(() => {
    const open = () => {
      const id = topicFromAddress();
      setHighlighted(id);
      if (!id) return;
      setQuery("");
      window.requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ block: "start" }),
      );
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        <label className="relative block">
          <span className="sr-only">Search help</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search help…"
            className="pl-8"
          />
        </label>
        <nav aria-label="Help topics" className="hidden space-y-3 lg:block">
          {areas.map(({ area, topics }) => (
            <div key={area} className="space-y-1">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {area}
              </p>
              <ul className="space-y-0.5">
                {topics.map((topic) => (
                  <li key={topic.id}>
                    <a
                      href={`#${topic.id}`}
                      className={cn(
                        "block rounded px-2 py-1 text-sm hover:bg-muted",
                        highlighted === topic.id && "bg-muted font-medium",
                      )}
                    >
                      {topic.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 space-y-8">
        {areas.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            No help topics match &ldquo;{query.trim()}&rdquo;. Try a shorter word.
          </p>
        ) : (
          areas.map(({ area, topics }) => (
            <section key={area} aria-label={area} className="space-y-3">
              <h2 className="font-display text-xl font-semibold">{area}</h2>
              {topics.map((topic) => (
                <Topic key={topic.id} topic={topic} highlighted={highlighted === topic.id} />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
