import { describe, expect, it } from "vitest";
import { clientProgramNames, hasOpenEnrollment } from "./enrollment-status";

const programs = [
  { id: "p-grant", name: "Grant" },
  { id: "p-coach", name: "Coaching" },
  { id: "p-old", name: "Old Program" },
];
const enrollments = [
  { id: "e1", clientId: "c1", programId: "p-grant", status: "active" },
  { id: "e1", clientId: "c1", programId: "p-grant", status: "active" }, // duplicate row
  { id: "e2", clientId: "c1", programId: "p-old", status: "completed" },
  { id: "e3", clientId: "c1", programId: "p-coach", status: "onboarding", isArchived: true },
  { id: "e4", clientId: "c2", programId: "p-old", status: "withdrawn" },
];

describe("clientProgramNames", () => {
  it("names the programs of open enrollments, once each", () => {
    expect(clientProgramNames("c1", enrollments, programs)).toEqual(["Grant"]);
  });

  it("falls back to closed enrollments when nothing is open", () => {
    expect(clientProgramNames("c2", enrollments, programs)).toEqual(["Old Program"]);
  });

  it("lists every enrollment for the archive", () => {
    expect(clientProgramNames("c1", enrollments, programs, { includeClosed: true })).toEqual([
      "Grant",
      "Old Program",
      "Coaching",
    ]);
  });

  it("is empty for a client with no enrollments", () => {
    expect(clientProgramNames("nobody", enrollments, programs)).toEqual([]);
  });
});

describe("hasOpenEnrollment", () => {
  it("ignores closed and archived enrollments", () => {
    expect(hasOpenEnrollment("c1", enrollments)).toBe(true);
    expect(hasOpenEnrollment("c2", enrollments)).toBe(false);
  });
});
