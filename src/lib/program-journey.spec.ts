import { describe, expect, it } from "vitest";
import { DEFAULT_JOURNEY, journeyToProgramFields, programJourney } from "./program-journey";

describe("program journey", () => {
  it("uses the full journey when a program has nothing configured", () => {
    expect(programJourney({ defaultWorkflow: [], statusPipeline: [] })).toEqual(DEFAULT_JOURNEY);
  });

  it("reads stages from the stored status pipeline and legacy workflow steps", () => {
    expect(
      programJourney({
        defaultWorkflow: ["Intake", "Terms", "Final Report"],
        statusPipeline: ["New Intake", "Active", "Contract Pending"],
      }),
    ).toEqual(["intake", "contract", "active", "completed"]);
  });

  it("maps chosen stages to workflow labels and detailed statuses, keeping required stages", () => {
    expect(journeyToProgramFields(["contract"])).toEqual({
      defaultWorkflow: ["Intake", "Contract", "Active", "Completed"],
      statusPipeline: [
        "New Intake",
        "Terms Proposed",
        "Contract Pending",
        "Active",
        "Final Report Needed",
        "Completed",
      ],
    });
  });

  it("round-trips a saved journey", () => {
    const journey = ["intake", "review", "active", "monitoring", "completed"] as const;
    expect(programJourney(journeyToProgramFields([...journey]))).toEqual(journey);
  });
});
