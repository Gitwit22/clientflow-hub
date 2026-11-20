import type { ReactNode } from "react";
import { HelpLink } from "@/components/help/HelpLink";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  helpTopic,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  /** A Help topic id: shows a "How this works" link to /help#<topic>. */
  helpTopic?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div>
        {eyebrow ? (
          <p className="mb-1.5 font-mono text-xs uppercase tracking-widest text-primary">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
        {helpTopic ? <HelpLink topic={helpTopic} className="mt-2" /> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
