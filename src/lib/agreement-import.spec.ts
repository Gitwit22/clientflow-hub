import { describe, expect, it } from "vitest";
import {
  AgreementImportError,
  extractAgreementText,
  normalizeImportedText,
  remainingBlanks,
  suggestMergeFields,
  textFromDocxHtml,
  textFromPdfPages,
  type PdfTextItem,
} from "./agreement-import";

/** A PDF line: text at a height (font size) and baseline; widths keep pieces apart or together. */
const line = (str: string, y: number, height = 11, x = 72): PdfTextItem => ({
  str,
  x,
  y,
  height,
  width: str.length * height * 0.5,
});

// Laid out like the IDI award agreement: wrapped lines 14.5 apart, paragraphs 26.5 apart, headings
// in a larger font, label lines, bullets, and a footer at the bottom of every page.
const page1: PdfTextItem[] = [
  line("Member Business Achievement Award Agreement", 700, 13),
  line("Award Date:", 670),
  line("November 12, 2026", 670, 11, 140),
  line("Award Amount: $500.00", 643.5),
  line("Business Name: ______________", 617),
  line("1. Purpose of the Award", 586.6, 13),
  line("The Inspired Detroit Initiative supports small", 559.3),
  line("businesses through funding opportunities.", 544.8),
  line("The award recognizes IDI members.", 518.3),
  line("Copyright © 2026 EA Management LLC.", 60, 7),
];
const page2: PdfTextItem[] = [
  line("5. Business Responsibilities", 700, 13),
  line("●Provide accurate business information.", 672.7),
  line("●Give 10% of the funds to the grant pool.", 658.2),
  line("Receiving an award does not alter the membership agreement.", 631.7),
  line("Business Name: ______________", 605.2),
  line("Signature: ______________", 578.7),
  line("Date: ______________", 552.2),
  line("Copyright © 2026 EA Management LLC.", 60, 7),
];

describe("rebuilding agreement text from a PDF", () => {
  const text = normalizeImportedText(textFromPdfPages([page1, page2]));

  it("joins wrapped lines, keeps paragraphs apart, and writes headings in capitals", () => {
    expect(text).toContain(
      "1. PURPOSE OF THE AWARD\n\nThe Inspired Detroit Initiative supports small businesses through funding opportunities.\n\nThe award recognizes IDI members.",
    );
    expect(text.startsWith("MEMBER BUSINESS ACHIEVEMENT AWARD AGREEMENT")).toBe(true);
  });

  it("keeps label lines and list items on their own lines, with printable bullets", () => {
    expect(text).toContain("Award Date: November 12, 2026\n\nAward Amount: $500.00");
    expect(text).toContain(
      "• Provide accurate business information.\n• Give 10% of the funds to the grant pool.\n\nReceiving an award",
    );
  });

  it("drops a footer repeated on every page but keeps fields that appear twice", () => {
    expect(text).not.toContain("Copyright");
    expect(text.match(/Business Name: _+/g)).toHaveLength(2);
  });
});

describe("suggested merge fields", () => {
  const imported = [
    "Award Date: November 12, 2026",
    "",
    "Award Amount: $500.00",
    "",
    "Business Name: ______________",
    "",
    "Business Representative: ______________",
    "",
    "The business will receive a $500.00 award. A $5,000.00 pool is separate.",
    "",
    "Authorized Representative: ______________",
    "",
    "Signature: ______________",
    "",
    "Date: ______________",
  ].join("\n");

  it("offers the business, representative, award amount and date, and the signature lines", () => {
    const suggestions = suggestMergeFields(imported, "award");
    expect(suggestions.map((item) => item.id)).toEqual([
      "business-name",
      "contact-name",
      "award-amount",
      "award-date",
      "signature-lines",
    ]);
    expect(suggestions.find((item) => item.id === "award-amount")?.count).toBe(2);
    expect(suggestions.find((item) => item.id === "signature-lines")?.count).toBe(3);
  });

  it("applying them leaves merge fields, no blanks, and other amounts untouched", () => {
    const applied = suggestMergeFields(imported, "award").reduce(
      (text, item) => item.apply(text),
      imported,
    );
    expect(applied).toContain("Award Date: {{award.date}}");
    expect(applied).toContain("Business Name: {{client.businessName}}");
    expect(applied).toContain("Business Representative: {{client.contactName}}");
    expect(applied).toContain(
      "The business will receive a {{award.amount}} award. A $5,000.00 pool is separate.",
    );
    expect(applied).not.toMatch(/Signature:|Authorized Representative:|^Date:/m);
    expect(remainingBlanks(applied)).toBe(0);
    // Once applied, nothing more is suggested.
    expect(suggestMergeFields(applied, "award")).toEqual([]);
  });

  it("never offers award fields for an enrollment agreement", () => {
    const ids = suggestMergeFields(imported, "enrollment").map((item) => item.id);
    expect(ids).not.toContain("award-amount");
    expect(ids).not.toContain("award-date");
    expect(ids).toContain("business-name");
  });
});

describe("Word documents", () => {
  it("turns headings into capitals and list items into bullets", () => {
    const html =
      "<h2>1. Purpose</h2><p>The award supports members.</p><ul><li>Provide information.</li><li>Use funds well.</li></ul><ol><li>First</li></ol>";
    expect(textFromDocxHtml(html)).toBe(
      "1. PURPOSE\n\nThe award supports members.\n\n• Provide information.\n• Use funds well.\n\n1. First",
    );
  });
});

describe("choosing a file to import", () => {
  it("refuses other file types and very large files with a clear message", async () => {
    await expect(
      extractAgreementText(new File(["x"], "agreement.txt", { type: "text/plain" })),
    ).rejects.toThrow("Import a PDF or a Word (.docx) document.");
    const large = new File(["x"], "agreement.pdf", { type: "application/pdf" });
    Object.defineProperty(large, "size", { value: 11 * 1024 * 1024 });
    await expect(extractAgreementText(large)).rejects.toBeInstanceOf(AgreementImportError);
  });
});
