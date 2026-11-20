import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_AREAS, HELP_ROUTES, HELP_TOPICS, PAGE_HELP_TOPICS, searchHelp } from "./help-content";

/** The route file that serves an app path (TanStack file routes). */
function routeFile(path: string) {
  const name = path === "/" ? "index" : path.slice(1);
  return ["tsx", "index.tsx"].map((suffix) =>
    resolve(__dirname, "../routes", suffix === "tsx" ? `${name}.tsx` : `${name}.index.tsx`),
  );
}

describe("help content", () => {
  it("gives every topic a unique, link-safe id, a summary and something to read", () => {
    const ids = HELP_TOPICS.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const topic of HELP_TOPICS) {
      expect(topic.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(topic.summary.trim()).not.toBe("");
      expect(topic.blocks.length).toBeGreaterThan(0);
      expect(HELP_AREAS).toContain(topic.area);
    }
  });

  it("covers every area", () => {
    for (const area of HELP_AREAS) {
      expect(HELP_TOPICS.some((topic) => topic.area === area)).toBe(true);
    }
  });

  it("only links to pages that exist", () => {
    for (const route of HELP_ROUTES) {
      expect(routeFile(route).some((file) => existsSync(file))).toBe(true);
    }
    for (const topic of HELP_TOPICS) {
      for (const link of topic.links ?? []) expect(HELP_ROUTES).toContain(link.to);
    }
  });

  it("has a topic for every page's How this works link", () => {
    const ids = new Set(HELP_TOPICS.map((topic) => topic.id));
    for (const topic of Object.values(PAGE_HELP_TOPICS)) expect(ids.has(topic)).toBe(true);
  });
});

describe("searching help", () => {
  it("matches every word, in titles, keywords and text, ignoring case", () => {
    const ids = searchHelp("AWARD agreement").map((topic) => topic.id);
    expect(ids).toContain("funding-awards");
    expect(ids).toContain("program-agreements");
    expect(searchHelp("ledger").map((topic) => topic.id)).toContain("billing-setup");
    expect(searchHelp("zzzz-nothing")).toEqual([]);
    expect(searchHelp("   ")).toHaveLength(HELP_TOPICS.length);
  });

  it("puts the topic about the subject first", () => {
    expect(searchHelp("monitoring")[0].id).toBe("monitoring");
    expect(searchHelp("welcome email")[0].id).toBe("welcome-email");
    expect(searchHelp("signature")[0].id).toBe("email-signature");
    expect(searchHelp("past payment")[0].id).toBe("billing-setup");
  });
});
