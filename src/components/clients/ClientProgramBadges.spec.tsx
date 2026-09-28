import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ProgramEnrollment } from "@/types";
import { ClientProgramBadges } from "./ClientProgramBadges";

const enrollment = (id: string, programId: string, status = "interested") =>
  ({ id, programId, clientId: "c1", status }) as unknown as ProgramEnrollment;

const programName = (programId: string) =>
  ({ p1: "The Inspired Detroit Initiative", p2: "Grant Program" })[programId] ?? "Unknown";

afterEach(cleanup);

describe("ClientProgramBadges", () => {
  it("renders one badge when the same enrollment appears four times in the list", () => {
    const duplicated = [1, 2, 3, 4].map(() => enrollment("e1", "p1"));
    render(<ClientProgramBadges enrollments={duplicated} programName={programName} />);
    expect(screen.getAllByText("The Inspired Detroit Initiative")).toHaveLength(1);
  });

  it("still renders distinct enrollments separately", () => {
    render(
      <ClientProgramBadges
        enrollments={[enrollment("e1", "p1"), enrollment("e2", "p2")]}
        programName={programName}
      />,
    );
    expect(screen.getAllByText("The Inspired Detroit Initiative")).toHaveLength(1);
    expect(screen.getAllByText("Grant Program")).toHaveLength(1);
  });

  it("shows the empty state only when there are no enrollments", () => {
    render(<ClientProgramBadges enrollments={[]} programName={programName} />);
    expect(screen.getByText("No program")).toBeTruthy();
  });

  it("shows the simplified enrollment status label", () => {
    render(<ClientProgramBadges enrollments={[enrollment("e1", "p1", "interested")]} programName={programName} />);
    expect(screen.getByText("New")).toBeTruthy();
  });
});
