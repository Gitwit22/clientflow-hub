import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agreementPlainText,
  escapeAgreementText,
  formattingProblems,
  parseAgreementLine,
  parseAgreementText,
} from "./agreement-format";
import fixtures from "./agreement-format.fixtures.json";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

describe("agreement formatting", () => {
  it.each(fixtures)("$name", ({ line, block }) => {
    expect(parseAgreementLine(line)).toEqual(block);
  });

  it("is the same parser and fixtures as the API (the signed PDF reads the same markup)", () => {
    const api = "../../clientflow-api/src/modules/contracts/";
    expect(readFileSync(here(`${api}agreement-format.ts`), "utf8")).toBe(
      readFileSync(here("./agreement-format.ts"), "utf8"),
    );
    expect(readFileSync(here(`${api}agreement-format.fixtures.json`), "utf8")).toBe(
      readFileSync(here("./agreement-format.fixtures.json"), "utf8"),
    );
  });

  it("splits the whole text into lines, keeping blank lines", () => {
    expect(parseAgreementText("# Title\r\n\r\nBody").map((block) => block.kind)).toEqual([
      "heading",
      "blank",
      "paragraph",
    ]);
  });

  it("escapes inserted values so they show exactly as they are", () => {
    const name = "**Best_Co** + Sons #1 -> <-";
    const runs = parseAgreementLine(`Client: ${escapeAgreementText(name)}`).runs;
    expect(runs).toEqual([{ text: `Client: ${name}` }]);
    expect(agreementPlainText(`# ${escapeAgreementText("A_b")}\n- item`)).toBe("A_b\n• item");
  });

  it("points out formatting that was opened but not closed", () => {
    expect(formattingProblems("**bold** fine\nthis **is open\n->centered\n++under")).toEqual([
      "Bold text on line 2 isn't closed with **.",
      "The centered line 3 needs -> at the start and <- at the end.",
      "Underlined text on line 4 isn't closed with ++.",
    ]);
    expect(formattingProblems("# ->Title<-\n\\*\\* escaped")).toEqual([]);
  });
});
