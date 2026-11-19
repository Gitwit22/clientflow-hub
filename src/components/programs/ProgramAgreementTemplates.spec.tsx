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
const extractAgreementText = vi.fn();
vi.mock("@/lib/agreement-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agreement-import")>()),
  extractAgreementText: (...a: unknown[]) => extractAgreementText(...a),
}));

const IMPORTED_TEXT = [
  "Award Amount: $500.00",
  "",
  "Business Name: ______________",
  "",
  "The business will receive $500.00.",
  "",
  "Signature: ______________",
].join("\n");
const pdf = () => new File(["%PDF-"], "IDI Award Agreement.pdf", { type: "application/pdf" });
const chooseImport = (file: File) =>
  fireEvent.change(screen.getByLabelText("Import agreement from a PDF or Word document"), {
    target: { files: [file] },
  });
const editorText = () => (screen.getByLabelText("Agreement text") as HTMLTextAreaElement).value;

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
  uploadStoredFile.mockResolvedValue({ id: "stored-original" });
  extractAgreementText.mockResolvedValue({ text: IMPORTED_TEXT, name: "IDI Award Agreement" });
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

  it("shows the new template after adding it, not its wording under the enrollment agreement", async () => {
    const before = workflow();
    const after = workflow();
    after.contract.templates.push(
      template("t-new", "LIVE Grant Giveaway Award Agreement", "award", "v-new") as never,
    );
    after.contract.versions.push(version("v-new", "t-new", "Award of {{award.amount}}.") as never);
    createProgramWorkflowContractTemplate.mockResolvedValue(after);
    const onChanged = vi.fn();
    const { rerender } = render(
      <ProgramAgreementTemplates program={program} workflow={before} onChanged={onChanged} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add agreement template" }));
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "LIVE Grant Giveaway Award Agreement" },
    });
    fireEvent.change(screen.getByLabelText("Agreement text"), {
      target: { value: "Award of {{award.amount}}." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add template" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    // The page reloads the program's agreements; the new one is the one being edited.
    rerender(
      <ProgramAgreementTemplates program={program} workflow={after} onChanged={onChanged} />,
    );
    expect(screen.queryByText(/Not available in enrollment agreements/)).toBeNull();
    expect((screen.getByLabelText("Agreement text") as HTMLTextAreaElement).value).toBe(
      "Award of {{award.amount}}.",
    );
    expect(screen.queryByRole("button", { name: "Use as enrollment agreement" })).toBeNull();
  });

  it("imports a document as a new award agreement, suggests merge fields, and keeps the original", async () => {
    render(
      <ProgramAgreementTemplates program={program} workflow={workflow()} onChanged={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add agreement template" }));
    chooseImport(pdf());

    await waitFor(() => expect(editorText()).toBe(IMPORTED_TEXT));
    expect((screen.getByLabelText("Template name") as HTMLInputElement).value).toBe(
      "IDI Award Agreement",
    );
    expect(screen.getByText("IDI Award Agreement.pdf")).toBeTruthy();
    const panel = screen.getByLabelText("Suggested merge fields");
    expect(panel.textContent).toContain("Replace “$500.00” with {{award.amount}} (2 places)");
    expect(panel.textContent).toContain("2 blanks (____) are left");

    fireEvent.click(screen.getByRole("button", { name: "Apply all" }));
    expect(editorText()).toBe(
      "Award Amount: {{award.amount}}\n\nBusiness Name: {{client.businessName}}\n\nThe business will receive {{award.amount}}.",
    );
    expect(screen.getByText("No more suggestions.")).toBeTruthy();
    expect(screen.queryByText(/blanks? \(____\)/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add template" }));
    await waitFor(() =>
      expect(createProgramWorkflowContractTemplate).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({
          name: "IDI Award Agreement",
          purpose: "award",
          content:
            "Award Amount: {{award.amount}}\n\nBusiness Name: {{client.businessName}}\n\nThe business will receive {{award.amount}}.",
          storedFileId: "stored-original",
        }),
      ),
    );
    // The original document is uploaded to the program's private agreement files.
    expect(uploadStoredFile).toHaveBeenCalledWith(expect.any(File), "program-workflow/contracts");
  });

  it("asks before an import replaces text already in the editor", async () => {
    render(
      <ProgramAgreementTemplates program={program} workflow={workflow()} onChanged={vi.fn()} />,
    );
    const existing = "Template draft only. Final legal language must be reviewed.";
    expect(editorText()).toBe(existing);
    chooseImport(pdf());
    expect(
      screen.getByText("Replace the text in the editor with “IDI Award Agreement.pdf”?"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep my text" }));
    expect(editorText()).toBe(existing);
    expect(extractAgreementText).not.toHaveBeenCalled();

    chooseImport(pdf());
    fireEvent.click(screen.getByRole("button", { name: "Replace text" }));
    await waitFor(() => expect(editorText()).toBe(IMPORTED_TEXT));
  });

  it("shows why a document can't be imported and leaves the text alone", async () => {
    const { AgreementImportError } = await import("@/lib/agreement-import");
    const { toast } = await import("sonner");
    extractAgreementText.mockRejectedValue(
      new AgreementImportError("No text was found in this PDF."),
    );
    render(
      <ProgramAgreementTemplates program={program} workflow={workflow()} onChanged={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add agreement template" }));
    chooseImport(pdf());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No text was found in this PDF."));
    expect(editorText()).toBe("");
    expect(screen.queryByLabelText("Suggested merge fields")).toBeNull();
  });

  it("puts the current agreement's text back when adding a template is cancelled", () => {
    render(
      <ProgramAgreementTemplates program={program} workflow={workflow()} onChanged={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add agreement template" }));
    expect((screen.getByLabelText("Agreement text") as HTMLTextAreaElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((screen.getByLabelText("Agreement text") as HTMLTextAreaElement).value).toBe(
      "Template draft only. Final legal language must be reviewed.",
    );
  });
});
