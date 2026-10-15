import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProgramParticipantDetail } from "@/types";
import { nextActionText } from "@/lib/program-deliverables";
import { ProgramParticipantRow } from "./ProgramParticipantRow";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const participant = {
  client: {
    id: "c1",
    businessName: "Black Economic Exchange",
    primaryContactName: "Tamika",
    email: "t@x.test",
  },
  enrollment: {
    id: "e1",
    status: "active",
    updatedAt: "2026-10-15T00:00:00.000Z",
    nextAction: "old typed note",
  },
  coreIntake: {},
  programIntake: [],
  forms: [],
  terms: [],
  contracts: [],
  monitoring: [],
  statusHistory: [],
} as unknown as ProgramParticipantDetail;

function renderRow(nextAction: string | null) {
  render(
    <ProgramParticipantRow
      participant={participant}
      assignedStaffName="Jordan"
      lastModifiedByName="Jordan"
      open={false}
      onOpenChange={() => {}}
      canWithdraw={false}
      onWithdraw={() => {}}
      canComplete={false}
      onComplete={() => {}}
      nextAction={nextAction}
    />,
  );
}

describe("program member next action", () => {
  afterEach(cleanup);

  it("shows the next action from the deliverables, never the old typed note", () => {
    renderRow(
      nextActionText(
        {
          title: "LIVE Grant Giveaway",
          status: "SCHEDULED",
          scheduledFor: "2026-11-02T00:00:00.000Z",
        },
        false,
      ),
    );
    expect(screen.getByText("Next: LIVE Grant Giveaway · Scheduled · Nov 2")).toBeTruthy();
    expect(screen.queryByText(/old typed note/)).toBeNull();
  });

  it("says when everything is done, and shows nothing without a checklist", () => {
    expect(nextActionText(null, true)).toBe("All current deliverables completed");
    expect(nextActionText(null, false)).toBeNull();
    renderRow(null);
    expect(screen.queryByText(/^Next:/)).toBeNull();
  });
});
