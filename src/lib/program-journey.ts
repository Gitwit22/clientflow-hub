import type { ClientStatus, Program } from "@/types";

export type JourneyStageId =
  "intake" | "review" | "contract" | "active" | "monitoring" | "completed";

export interface JourneyStage {
  id: JourneyStageId;
  label: string;
  /** Detailed internal statuses this stage stands for, in order. */
  statuses: ClientStatus[];
  /** Every program has these stages; staff can't turn them off. */
  required?: boolean;
}

// Staff pick stages; the system maps each stage to the detailed statuses behind it.
export const JOURNEY_STAGES: JourneyStage[] = [
  { id: "intake", label: "Intake", statuses: ["New Intake"], required: true },
  {
    id: "review",
    label: "Review",
    statuses: ["Needs Review", "More Information Needed", "Qualified", "Approved"],
  },
  { id: "contract", label: "Contract", statuses: ["Terms Proposed", "Contract Pending"] },
  { id: "active", label: "Active", statuses: ["Active"], required: true },
  { id: "monitoring", label: "Monitoring", statuses: ["Monitoring"] },
  {
    id: "completed",
    label: "Completed",
    statuses: ["Final Report Needed", "Completed"],
    required: true,
  },
];

export const DEFAULT_JOURNEY: JourneyStageId[] = JOURNEY_STAGES.map((stage) => stage.id);

// Older programs stored free-text workflow steps; map the common ones onto stages.
const LEGACY_STEP_TO_STAGE: Record<string, JourneyStageId> = {
  intake: "intake",
  form: "intake",
  review: "review",
  qualified: "review",
  approved: "review",
  terms: "contract",
  contract: "contract",
  active: "active",
  monitoring: "monitoring",
  "final report": "completed",
  completed: "completed",
  completion: "completed",
};

/** The journey stages a program currently uses, in journey order. */
export function programJourney(
  program: Pick<Program, "defaultWorkflow" | "statusPipeline">,
): JourneyStageId[] {
  const enabled = new Set<JourneyStageId>();
  for (const status of program.statusPipeline ?? []) {
    const stage = JOURNEY_STAGES.find((candidate) => candidate.statuses.includes(status));
    if (stage) enabled.add(stage.id);
  }
  for (const step of program.defaultWorkflow ?? []) {
    const stage = LEGACY_STEP_TO_STAGE[step.trim().toLowerCase()];
    if (stage) enabled.add(stage);
  }
  if (enabled.size === 0) return DEFAULT_JOURNEY;
  for (const stage of JOURNEY_STAGES) if (stage.required) enabled.add(stage.id);
  return JOURNEY_STAGES.filter((stage) => enabled.has(stage.id)).map((stage) => stage.id);
}

/** The stored program fields for a chosen journey. */
export function journeyToProgramFields(
  stageIds: JourneyStageId[],
): Pick<Program, "defaultWorkflow" | "statusPipeline"> {
  const stages = JOURNEY_STAGES.filter((stage) => stage.required || stageIds.includes(stage.id));
  return {
    defaultWorkflow: stages.map((stage) => stage.label),
    statusPipeline: stages.flatMap((stage) => stage.statuses),
  };
}

export function journeyLabel(stageIds: JourneyStageId[]): string {
  return JOURNEY_STAGES.filter((stage) => stageIds.includes(stage.id))
    .map((stage) => stage.label)
    .join(" → ");
}
