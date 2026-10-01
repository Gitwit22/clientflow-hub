import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicFormData } from "@/lib/apiClient";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useParams: () => ({ token: "token-1" }),
  }),
}));

const getPublicForm = vi.fn<(token: string) => Promise<PublicFormData>>();
vi.mock("@/lib/apiClient", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPublicForm: (token: string) => getPublicForm(token),
}));

const { Route } = await import("./s.$token");
const Page = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

describe("public intake form, new copy after a submission", () => {
  it("starts filled in with what's on file and the client's programs selected", async () => {
    getPublicForm.mockResolvedValue({
      assignment: { id: "a2", status: "sent", dueDate: "2026-10-08" },
      form: { id: "f1", name: "General Intake", description: "", fields: [] },
      program: { name: "EA Management Program" },
      contact: { name: "John Steele" },
      prefill: { "brief-business-description": "IT services" },
      programPrefill: { p1: { goal: "Grow sales" } },
      selectedProgramIds: ["p1", "retired-program"],
      intakeConfiguration: {
        configurationToken: "cfg",
        programs: [
          { id: "p1", name: "The Inspired Detroit Initiative" },
          { id: "p2", name: "Grant Program" },
        ],
        sections: [
          {
            id: "core",
            kind: "core",
            templateId: "f1",
            templateVersion: 1,
            programId: null,
            title: "General Intake",
            description: "",
            fields: [
              {
                id: "brief-business-description",
                label: "Brief business description",
                type: "textarea",
                required: false,
              },
            ],
          },
          {
            id: "program:p1",
            kind: "program",
            templateId: "s1",
            templateVersion: 1,
            programId: "p1",
            title: "IDI questions",
            description: "",
            fields: [{ id: "goal", label: "Your goal", type: "text", required: false }],
          },
        ],
      },
    } as unknown as PublicFormData);

    render(<Page />);

    expect(await screen.findByDisplayValue("IT services")).toBeTruthy();
    expect(screen.getByDisplayValue("Grow sales")).toBeTruthy();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  });
});
