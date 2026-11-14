import type { SetupCopyPart } from "@/lib/apiClient";
import type { Program } from "@/types";

export const SETUP_COPY_PARTS: { part: SetupCopyPart; label: string; hint: string }[] = [
  {
    part: "journey",
    label: "Journey & settings",
    hint: "Client journey, required documents, monitoring",
  },
  { part: "intakeQuestions", label: "Intake questions", hint: "The program's own questions" },
  { part: "agreements", label: "Agreements", hint: "Enrollment and award agreements" },
  { part: "welcomeEmail", label: "Welcome email", hint: "Subject, message and guide" },
  { part: "deliverables", label: "Deliverables", hint: "Monthly checklist items" },
  { part: "billing", label: "Billing defaults", hint: "Default fee and frequency" },
  { part: "automation", label: "Automatic emails", hint: "On/off switches and custom emails" },
];

export interface SetupCopyChoice {
  sourceProgramId: string;
  parts: SetupCopyPart[];
}

/** The program to start from by default: an active one, which is the setup that already works. */
export function defaultCopySource(programs: Program[], excludeId?: string): string {
  const candidates = programs.filter((program) => program.id !== excludeId);
  return (candidates.find((program) => program.isActive) ?? candidates[0])?.id ?? "";
}
