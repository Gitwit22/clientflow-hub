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
  component: HelpPage,
});

function HelpPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Help"
        title="How to use ClientFlow"
        description="Step-by-step help for every part of ClientFlow. Search, or pick a topic."
      />
      <HelpCenter />
    </div>
  );
}
