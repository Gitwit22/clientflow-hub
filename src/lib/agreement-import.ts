import type { AgreementPurpose } from "@/types";

/**
 * Importing an agreement from a PDF or Word document into the agreement editor: the document's
 * text becomes the agreement text (clients always sign text, which ClientFlow fills in per client),
 * and blanks or one-off values such as "Business Name: ____" or "$500.00" are offered as merge
 * fields. Everything runs in the browser; nothing is saved until staff save the agreement.
 */

export const IMPORT_ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export class AgreementImportError extends Error {}

export interface ImportedAgreement {
  text: string;
  /** The file name without its extension, as a starting name for a new template. */
  name: string;
}

/** One piece of positioned text on a PDF page (PDF y grows upwards). */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  height: number;
  /** Width of the text; used to tell whether two pieces on a line need a space between them. */
  width?: number;
}

/** Reads a text-based PDF or a .docx file and returns its text, ready for the agreement editor. */
export async function extractAgreementText(file: File): Promise<ImportedAgreement> {
  const name = file.name.replace(/\.[^.]+$/, "").trim();
  if (file.size > MAX_IMPORT_BYTES) {
    throw new AgreementImportError("This file is larger than 10 MB. Import a smaller document.");
  }
  const kind = documentKind(file);
  if (!kind) {
    throw new AgreementImportError("Import a PDF or a Word (.docx) document.");
  }
  const raw =
    kind === "pdf" ? textFromPdfPages(await pdfTextItems(file)) : await textFromDocx(file);
  const text = normalizeImportedText(raw);
  if (!text) {
    throw new AgreementImportError(
      kind === "pdf"
        ? "No text was found in this PDF. It may be a scanned image; import the original Word or Google Docs file instead."
        : "No text was found in this document.",
    );
  }
  return { text, name };
}

function documentKind(file: File): "pdf" | "docx" | null {
  const lower = file.name.toLowerCase();
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    return "docx";
  }
  return null;
}

async function pdfTextItems(file: File): Promise<PdfTextItem[][]> {
  // Loaded only when someone imports a PDF, so the editor page stays light.
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  // Only the text is read: no forms (XFA), scripts or rendering.
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    enableXfa: false,
  });
  try {
    let document;
    try {
      document = await task.promise;
    } catch {
      throw new AgreementImportError(
        "This PDF couldn't be read. It may be damaged or password protected.",
      );
    }
    const pages: PdfTextItem[][] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        items.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          height: Math.abs(item.height || item.transform[3] || 0),
          width: item.width,
        });
      }
      pages.push(items);
    }
    return pages;
  } finally {
    void task.destroy();
  }
}

interface PdfLine {
  text: string;
  y: number;
  height: number;
}

const round = (value: number) => Math.round(value * 2) / 2;

function mostCommon(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = values[0] ?? 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function pageLines(items: PdfTextItem[]): PdfLine[] {
  const rows: { y: number; items: PdfTextItem[] }[] = [];
  for (const item of items) {
    if (!item.str) continue;
    const tolerance = Math.max(2, item.height * 0.4);
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const sorted = row.items.sort((a, b) => a.x - b.x);
      let joined = "";
      sorted.forEach((item, index) => {
        const before = sorted[index - 1];
        // Separate pieces (e.g. a bold "Award Date:" and its value) need a space between them.
        const apart =
          before?.width !== undefined && item.x - (before.x + before.width) > item.height * 0.15;
        if (apart && !/\s$/.test(joined) && !/^\s/.test(item.str)) joined += " ";
        joined += item.str;
      });
      const text = joined.replace(/\s+/g, " ").trim();
      return { text, y: row.y, height: Math.max(...sorted.map((item) => item.height)) };
    })
    .filter((line) => line.text);
}

const BULLET_START = /^(?:[•●▪◦■]|[-*]\s)/;
const NUMBERED_START = /^\d+[.)]\s/;
const LABEL_LINE = /^[A-Z][A-Za-z /'&-]{1,40}:(\s|$)/;

/**
 * Rebuilds paragraphs from the lines of PDF pages: lines that wrap within a paragraph are joined,
 * a larger gap starts a new paragraph, lines in a larger font become ALL-CAPS headings (which is
 * how agreement headings are written so they print bold in the signed copy), and a header or
 * footer repeated on every page is dropped.
 */
export function textFromPdfPages(pages: PdfTextItem[][]): string {
  const linesByPage = pages.map(pageLines);
  const allLines = linesByPage.flat();
  if (!allLines.length) return "";

  // A header or footer (e.g. "Copyright © 2026 …") sits at the top or bottom of every page and
  // isn't agreement text. Text repeated elsewhere, such as "Business Name: ____", is kept.
  const edgeTexts = linesByPage.map(
    (lines) => new Set([...lines.slice(0, 2), ...lines.slice(-2)].map((line) => line.text)),
  );
  const repeated = (text: string) =>
    linesByPage.length > 1 && edgeTexts.every((edges) => edges.has(text));

  const bodyHeight = mostCommon(allLines.map((line) => round(line.height)));
  const gaps: number[] = [];
  for (const lines of linesByPage) {
    for (let index = 1; index < lines.length; index += 1) {
      if (
        round(lines[index].height) === bodyHeight &&
        round(lines[index - 1].height) === bodyHeight
      ) {
        gaps.push(round(lines[index - 1].y - lines[index].y));
      }
    }
  }
  // Line spacing within a paragraph is the smallest gap that recurs; gaps between paragraphs are
  // larger (and in short-paragraph documents, more common).
  const recurring = gaps.filter((gap) => gaps.filter((other) => other === gap).length > 1);
  const lineGap = recurring.length
    ? Math.min(...recurring)
    : gaps.length
      ? Math.min(...gaps)
      : bodyHeight * 1.2;

  const paragraphs: string[] = [];
  let current: string | null = null;
  const flush = () => {
    if (current !== null) paragraphs.push(current);
    current = null;
  };

  for (const lines of linesByPage) {
    let previous: PdfLine | null = null;
    for (const line of lines) {
      if (repeated(line.text)) continue;
      const isHeading =
        bodyHeight > 0 &&
        line.height >= bodyHeight * 1.15 &&
        line.text.length <= 90 &&
        !/[.,;:]$/.test(line.text);
      if (isHeading) {
        flush();
        paragraphs.push(line.text.toUpperCase());
        previous = line;
        continue;
      }
      const startsBlock =
        BULLET_START.test(line.text) ||
        NUMBERED_START.test(line.text) ||
        LABEL_LINE.test(line.text);
      // At the top of a page, a sentence that clearly runs on (no closing punctuation, next line
      // in lower case) continues the paragraph from the previous page.
      const runsOn =
        previous === null &&
        current !== null &&
        !/[.!?:]$/.test(current) &&
        /^[a-z]/.test(line.text);
      const gapBreak = previous !== null && previous.y - line.y > lineGap * 1.35;
      // "Label: value" lines are one line each; nothing continues them.
      const afterLabel = current !== null && LABEL_LINE.test(current);
      if (
        current === null ||
        startsBlock ||
        gapBreak ||
        afterLabel ||
        (previous === null && !runsOn)
      ) {
        flush();
        current = line.text;
      } else {
        current = `${current} ${line.text}`;
      }
      previous = line;
    }
  }
  flush();

  return joinParagraphs(paragraphs);
}

/** Lines that belong to the same list stay together; everything else is separated by a blank line. */
function joinParagraphs(paragraphs: string[]): string {
  let text = "";
  paragraphs.forEach((paragraph, index) => {
    if (index === 0) {
      text = paragraph;
      return;
    }
    const sameList = BULLET_START.test(paragraph) && BULLET_START.test(paragraphs[index - 1]);
    text += sameList ? `\n${paragraph}` : `\n\n${paragraph}`;
  });
  return text;
}

async function textFromDocx(file: File): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value;
  } catch {
    throw new AgreementImportError(
      "This Word document couldn't be read. Save it as .docx and try again.",
    );
  }
  return textFromDocxHtml(html);
}

/** Word's structure as agreement text: headings in ALL CAPS, list items as bullets. */
export function textFromDocxHtml(html: string): string {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const blocks: string[] = [];
  const clean = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
  const walk = (element: Element) => {
    for (const child of Array.from(element.children)) {
      const tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const text = clean(child.textContent);
        if (text) blocks.push(text.toUpperCase());
      } else if (tag === "ul" || tag === "ol") {
        const items = Array.from(child.children)
          .filter((item) => item.tagName.toLowerCase() === "li")
          .map(
            (item, index) => `${tag === "ol" ? `${index + 1}.` : "•"} ${clean(item.textContent)}`,
          )
          .filter((item) => item.length > 2);
        if (items.length) blocks.push(items.join("\n"));
      } else if (tag === "table") {
        for (const row of Array.from(child.querySelectorAll("tr"))) {
          const cells = Array.from(row.children)
            .map((cell) => clean(cell.textContent))
            .filter(Boolean);
          if (cells.length) blocks.push(cells.join(" "));
        }
      } else if (tag === "p") {
        const text = clean(child.textContent);
        if (text) blocks.push(text);
      } else {
        walk(child);
      }
    }
  };
  walk(body);
  return blocks.join("\n\n");
}

/** Tidies imported text: bullets the signed copy can print, no trailing spaces, no long gaps. */
export function normalizeImportedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*[●▪◦■]\s*/gm, "• ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface MergeFieldSuggestion {
  id: string;
  /** What will change, in staff words. */
  label: string;
  /** How many places in the text it changes. */
  count: number;
  apply: (text: string) => string;
}

const BLANK = "_{3,}";
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Offers to rewrite every line matching `pattern`, whose first group is the line's label. */
function lineSuggestion(
  id: string,
  label: string,
  text: string,
  pattern: RegExp,
  replacement: (lineLabel: string) => string,
): MergeFieldSuggestion | null {
  const count = Array.from(text.matchAll(pattern)).length;
  if (!count) return null;
  return {
    id,
    label,
    count,
    apply: (value) => value.replace(pattern, (_line, lineLabel: string) => replacement(lineLabel)),
  };
}

function valueSuggestion(id: string, label: string, text: string, value: string, field: string) {
  const pattern = new RegExp(`(?<![\\w$])${escapeRegExp(value)}(?![\\w])`, "g");
  const count = Array.from(text.matchAll(pattern)).length;
  if (!count) return null;
  return {
    id,
    label: `${label} (${count === 1 ? "1 place" : `${count} places`})`,
    count,
    apply: (current: string) => current.replace(pattern, field),
  } satisfies MergeFieldSuggestion;
}

const DATE_VALUE =
  /^(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})$/i;

/**
 * Merge fields to offer for imported text: blanks for the business and its representative, the
 * award's amount and date written into the document, and blank signature lines (ClientFlow records
 * both electronic signatures, so those lines are removed). Award fields are only offered for award
 * agreements.
 */
export function suggestMergeFields(
  text: string,
  purpose: AgreementPurpose,
): MergeFieldSuggestion[] {
  const suggestions: (MergeFieldSuggestion | null)[] = [];

  suggestions.push(
    lineSuggestion(
      "business-name",
      "Fill “Business Name” blanks with {{client.businessName}}",
      text,
      new RegExp(`^((?:Business|Company|Organization) Name:)[ \\t]*${BLANK}[ \\t]*$`, "gim"),
      (lineLabel) => `${lineLabel} {{client.businessName}}`,
    ),
    lineSuggestion(
      "contact-name",
      "Fill representative / contact blanks with {{client.contactName}}",
      text,
      new RegExp(
        `^((?:Business )?(?:Representative|Contact(?: Name)?|Owner(?: Name)?|Printed Name|Print Name):)[ \\t]*${BLANK}[ \\t]*$`,
        "gim",
      ),
      (lineLabel) => `${lineLabel} {{client.contactName}}`,
    ),
  );

  if (purpose === "award") {
    const amount = /^Award Amount:\s*(\$\s?[\d,]+(?:\.\d{2})?)\s*$/im.exec(text)?.[1];
    if (amount) {
      suggestions.push(
        valueSuggestion(
          "award-amount",
          `Replace “${amount}” with {{award.amount}}`,
          text,
          amount,
          "{{award.amount}}",
        ),
      );
    }
    const date = /^Award Date:\s*(.+?)\s*$/im.exec(text)?.[1];
    if (date && DATE_VALUE.test(date)) {
      suggestions.push(
        valueSuggestion(
          "award-date",
          `Replace “${date}” with {{award.date}}`,
          text,
          date,
          "{{award.date}}",
        ),
      );
    }
    suggestions.push(
      lineSuggestion(
        "award-amount-blank",
        "Fill “Award Amount” blanks with {{award.amount}}",
        text,
        new RegExp(`^((?:Award|Grant) Amount:)[ \\t]*${BLANK}[ \\t]*$`, "gim"),
        (lineLabel) => `${lineLabel} {{award.amount}}`,
      ),
    );
  }

  const signatureLines = new RegExp(
    `^(?:Authorized Representative|Signature|Date|Signed|Title|Witness):[ \\t]*${BLANK}[ \\t]*\\n?`,
    "gim",
  );
  const signatureCount = Array.from(text.matchAll(signatureLines)).length;
  if (signatureCount) {
    suggestions.push({
      id: "signature-lines",
      label: `Remove ${signatureCount === 1 ? "1 blank signature line" : `${signatureCount} blank signature lines`} (ClientFlow records both electronic signatures)`,
      count: signatureCount,
      apply: (value) =>
        value
          .replace(signatureLines, "")
          .replace(/\n{3,}/g, "\n\n")
          .trimEnd(),
    });
  }

  return suggestions.filter((suggestion): suggestion is MergeFieldSuggestion =>
    Boolean(suggestion),
  );
}

/** Blanks still in the text after the suggestions, which staff need to fill or remove themselves. */
export function remainingBlanks(text: string): number {
  return Array.from(text.matchAll(new RegExp(BLANK, "g"))).length;
}
