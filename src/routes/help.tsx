import { createFileRoute } from "@tanstack/react-router";
import { HelpCenter } from "@/components/help/HelpCenter";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help — ClientFlow" },
      {
        name: "description",
        content: "How to use ClientFlow: clients, programs, agreements, funding, billing and more.",
      },
      { property: "og:title", content: "Help — ClientFlow" },
      {
        property: "og:description",
        content: "How to use ClientFlow: clients, programs, agreements, funding, billing and more.",
      },
    ],
  }),
  // ?q= comes from "See all help results" in the top-bar search.
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q.slice(0, 100) : undefined,
  }),
  component: HelpPage,
});

function HelpPage() {
  const { q } = Route.useSearch();
  return (
    <div>
      <PageHeader
        eyebrow="Help"
        title="How to use ClientFlow"
        description="Step-by-step help for every part of ClientFlow. Search, or pick a topic."
      />
      <HelpCenter initialQuery={q} />
    </div>
  );
}
