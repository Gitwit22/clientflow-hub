import { Link } from "@tanstack/react-router";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";

/** "How this works": opens the matching topic on the Help page (/help#<topic>). */
export function HelpLink({ topic, className }: { topic: string; className?: string }) {
  return (
    <Link
      to="/help"
      hash={topic}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline",
        className,
      )}
    >
      <CircleHelp aria-hidden className="size-3.5" />
      How this works
    </Link>
  );
}
