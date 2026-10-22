import type { FinalReport } from "@/types";

/** How participation ended. Matches the API (lifecycle/final-report.ts). */
export const FINISHED_OUTCOMES: readonly string[] = [
  "Program Complete",
  "Contract Complete",
  "Paid in Full",
  "Grant Requirements Complete",
  "Sponsorship Fulfilled",
];
export const EARLY_OUTCOMES: readonly string[] = ["Closed Early", "Defaulted"];
export const PROGRAM_OUTCOMES: readonly string[] = [...FINISHED_OUTCOMES, ...EARLY_OUTCOMES];

/** Reports saved before drafts existed have no status; they were finalized when saved. */
export const isFinalized = (report: Pick<FinalReport, "status">) => report.status !== "DRAFT";

/**
 * Prints one element on its own (the browser's dialog also offers "Save as PDF"): everything else
 * on the page is hidden while printing, then the page returns to normal.
 */
export function printElement(elementId: string) {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.setAttribute("data-print-target", "true");
  document.body.classList.add("printing-one");
  const cleanup = () => {
    element.removeAttribute("data-print-target");
    document.body.classList.remove("printing-one");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  // Browsers that don't fire afterprint return from print() once the dialog closes.
  window.setTimeout(cleanup, 1000);
}
