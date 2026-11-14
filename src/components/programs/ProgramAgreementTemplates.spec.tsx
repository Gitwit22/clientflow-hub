import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Program, ProgramWorkflow } from "@/types";
import { ProgramAgreementTemplates } from "./ProgramAgreementTemplates";

const updateProgramWorkflow = vi.fn();
const updateProgramWorkflowContractTemplate = vi.fn();
const createProgramWorkflowContractTemplate = vi.fn();
const createProgramWorkflowContractVersion = vi.fn();
const uploadStoredFile = vi.fn();

vi.mock("@/lib/api", () => ({
  updateProgramWorkflow: (...a: unknown[]) => updateProgramWorkflow(...a),
  updateProgramWorkflowContractTemplate: (...a: unknown[]) =>
    updateProgramWorkflowContractTemplate(...a),
  createProgramWorkflowContractTemplate: (...a: unknown[]) =>
    createProgramWorkflowContractTemplate(...a),
  createProgramWorkflowContractVersion: (...a: unknown[]) =>
    createProgramWorkflowContractVersion(...a),
  uploadStoredFile: (...a: unknown[]) => uploadStoredFile(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const program = { id: "p1", name: "IDI" } as Program;
const at = "2026-11-01T00:00:00.000Z";
const template = (
  id: string,
  name: string,
  purpose: "enrollment" | "award",
  activeVersionId: string,
) => ({
  id,
  organizationId: "o1",
  programId: "p1",
  name,
  signatureRequired: true,
  isActive: true,
  purpose,
  activeVersionId,
  createdAt: at,
  updatedAt: at,
});
const version = (id: string, templateId: string, content: string, n = 1) => ({
  id,
  organizationId: "o1",
  templateId,
  version: n,
  title: null,
  content,
  signableFields: [],
  createdBy: "staff",
  createdAt: at,
});

function workflow(): ProgramWorkflow {
  return {
    config: {
      enabled: true,
      sendContractAfterIntake: false,
      sendWelcomeAfterContractSigned: false,
      activeContractTemplateId: "t-join",
      activeContractVersionId: "v-join",
      activeWelcomeEmailTemplateId: null,
      activeWelcomeEmailVersionId: null,
    },
    contract: {
      templates: [
        template("t-join", "Membership Agreement", "enrollment", "v-join"),
        template("t-award", "Member Fund Award Agreement", "award", "v-award-2"),
      ],
      versions: [
        version("v-join", "t-join", "Template draft only. Final legal language must be reviewed."),
        version("v-award-2", "t-award", "Award {{award.amount}}", 2),
        version("v-award-1", "t-award", "Old award text", 1),
      ],
      activeTemplate: null,
      activeVersion: null,
    },
    welcomeEmail: { templates: [], versions: [], activeTemplate: null, activeVersion: null },
    automation: { sendContractAfterIntake: false, sendWelcomeAfterContractSigned: false },
  } as unknown as ProgramWorkflow;
}

beforeEach(() => {
  vi.clearAllMocks();
  updateProgramWorkflow.mockResolvedValue({});
  updateProgramWorkflowContractTemplate.mockResolvedValue({});
  createProgramWorkflowContractVersion.mockResolvedValue({});
  createProgramWorkflowContractTemplate.mockResolvedValue({});
});
afterEach(cleanup);

describe("ProgramAgreementTemplates", () => {
  it("lists every agreement and marks which one clients sign to join", () => {
    render(
      <ProgramAgreementTemplates program={program} workflow={workflow()} onChanged={vi.fn()} />,
    );
    expect(screen.getByText("Membership Agreement")).toBeTruthy();
    expect(screen.getByText("Enrollment agreement")).toBeTruthy();
    expect(screen.getByText("Award agreement")).toBeTruthy();
  });

  it("warns when the enrollment agreement still has starter wording", () => {
    render(
      <ProgramAgreementTemplates program={program} workflow={workflow()} onChanged={vi.fn()} />,
    );
    expect(screen.getByRole("alert").textContent).toContain("starter wording");
  });

  it("activates an award template's version on that template, not as the enrollment agreement", async () => {
    render(
      <ProgramAgreementTemplates program={program} workflow={workflow()} onChanged={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Member Fund Award Agreement"));
    fireEvent.click(screen.getByText(/Show 1 older version/));
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() =>
      expect(updateProgramWorkflowContractTemplate).toHaveBeenCalledWith("p1", "t-award", {
        activeVersionId: "v-award-1",
      }),
    );
    expect(updateProgramWorkflow).not.toHaveBeenCalled();
    // An award template is never offered as the enrollment agreement.
    expect(screen.queryByRole("button", { name: "Use as enrollment agreement" })).toBeNull();
  });

  it("blocks saving award fields into the enrollment agreement", () => {
    render(
      <ProgramAgreementTemplates program={program} workflow={workflow()} onChanged={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Agreement text"), {
      target: { value: "Amount {{award.amount}}" },
    });
    expect(screen.getByText(/Not available in enrollment agreements/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save as new version" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("previews the text with sample details and saves a new version", async () => {
    const onChanged = vi.fn();
    render(
      <ProgramAgreementTemplates program={program} workflow={workflow()} onChanged={onChanged} />,
    );
    fireEvent.change(screen.getByLabelText("Agreement text"), {
      target: { value: "Welcome {{client.businessName}}." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview with sample details" }));
    expect(screen.getByLabelText("Sample agreement").textContent).toBe(
      "Welcome Rivers Bakery LLC.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    await waitFor(() =>
      expect(createProgramWorkflowContractVersion).toHaveBeenCalledWith("p1", "t-join", {
        title: undefined,
        content: "Welcome {{client.businessName}}.",
        storedFileId: undefined,
        makeActive: true,
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("adds an award agreement template", async () => {
    render(
      <ProgramAgreementTemplates program={program} workflow={workflow()} onChanged={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add agreement template" }));
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Member Fund Award Agreement 2027" },
    });
    fireEvent.change(screen.getByLabelText("Agreement text"), {
      target: { value: "Award of {{award.amount}} to {{client.businessName}}." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add template" }));
    await waitFor(() =>
      expect(createProgramWorkflowContractTemplate).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ name: "Member Fund Award Agreement 2027", purpose: "award" }),
      ),
    );
  });
});
