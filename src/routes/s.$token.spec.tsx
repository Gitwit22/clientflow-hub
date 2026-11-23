import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicFormData } from "@/lib/apiClient";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useParams: () => ({ token: "token-1" }),
  }),
}));

const getPublicForm = vi.fn<(token: string) => Promise<PublicFormData>>();
const submitPublicForm = vi.fn();
vi.mock("@/lib/apiClient", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPublicForm: (token: string) => getPublicForm(token),
  submitPublicForm: (...args: unknown[]) => submitPublicForm(...args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { Route } = await import("./s.$token");
const Page = (Route as unknown as { options: { component: ComponentType } }).options.component;

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function formWithPrograms(programs: { id: string; name: string }[]): PublicFormData {
  return {
    assignment: { id: "a1", status: "sent", dueDate: null },
    form: { id: "f1", name: "General Intake", description: "", fields: [] },
    program: { name: "EA Management Program" },
    contact: { name: "New Client" },
    prefill: {},
    programPrefill: {},
    selectedProgramIds: [],
    intakeConfiguration: {
      configurationToken: "cfg",
      programs,
      sections: [
        {
          id: "core",
          kind: "core",
          templateId: "f1",
          templateVersion: 1,
          programId: null,
          title: "General Intake",
          description: "",
          fields: [],
        },
      ],
    },
  } as unknown as PublicFormData;
}

describe("public intake form, choosing a program", () => {
  it("won't submit until at least one program is chosen, and says so next to the programs", async () => {
    getPublicForm.mockResolvedValue(
      formWithPrograms([
        { id: "p1", name: "The Inspired Detroit Initiative" },
        { id: "p2", name: "Grant Program" },
      ]),
    );
    submitPublicForm.mockResolvedValue({ success: true });
    render(<Page />);

    expect(await screen.findByText("Choose at least one program")).toBeTruthy();
    expect(screen.getByText("0 of 1 required fields completed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(screen.getByRole("alert").textContent).toMatch(
      /Choose at least one program to continue/,
    );
    expect(submitPublicForm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Grant Program" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("1 of 1 required fields completed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(submitPublicForm).toHaveBeenCalledTimes(1));
    expect(submitPublicForm.mock.calls[0][1]).toEqual(
      expect.objectContaining({ selectedProgramIds: ["p2"] }),
    );
  });

  it("can be submitted without a program when none are offered", async () => {
    getPublicForm.mockResolvedValue(formWithPrograms([]));
    submitPublicForm.mockResolvedValue({ success: true });
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: /submit/i }));
    await waitFor(() => expect(submitPublicForm).toHaveBeenCalledTimes(1));
  });
});

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
