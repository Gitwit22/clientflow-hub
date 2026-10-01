import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setState } from "@/lib/store";

// --- Mocks: the route talks to the API layer and mounts many dialogs; none of that is under test.
const refreshClientProfile = vi.fn();
const createEnrollment = vi.fn();
const cfGetEnrollmentBillingSummary = vi.fn();
const cfGetProgramBillingConfig = vi.fn();
const cfGetBillingDashboard = vi.fn();

vi.mock("@/lib/api", () => ({
  addCommunication: vi.fn(),
  archiveClient: vi.fn(),
  cancelFormAssignment: vi.fn(),
  createEnrollment: (...args: unknown[]) => createEnrollment(...args),
  createEnrollmentMonitoring: vi.fn(),
  createFinalReport: vi.fn(),
  downloadDocument: vi.fn(),
  downloadExecutedContract: vi.fn(),
  refreshClientContracts: vi.fn(),
  refreshClientProfile: (...args: unknown[]) => refreshClientProfile(...args),
  recordMonitoringResult: vi.fn(),
  restoreClient: vi.fn(),
  updateClient: vi.fn(),
  uploadDocument: vi.fn(),
}));

vi.mock("@/lib/apiClient", () => ({
  acfGenerateContract: vi.fn(),
  acfSendContract: vi.fn(),
  acfSendIntakeNow: vi.fn(),
  cfGetEnrollmentBillingSummary: (...args: unknown[]) => cfGetEnrollmentBillingSummary(...args),
  cfGetProgramBillingConfig: (...args: unknown[]) => cfGetProgramBillingConfig(...args),
  cfGetBillingDashboard: (...args: unknown[]) => cfGetBillingDashboard(...args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Dialogs are not under test; stub them so the route renders on its own.
vi.mock("@/components/dialogs/FormRendererDialog", () => ({ FormRendererDialog: () => null }));
vi.mock("@/components/dialogs/EditClientDialog", () => ({ EditClientDialog: () => null }));
vi.mock("@/components/dialogs/SendFormDialog", () => ({
  SendFormDialog: ({ open, kind }: { open: boolean; kind?: string }) =>
    open ? <div data-testid={`dialog-form-${kind ?? "legacy"}`} /> : null,
}));
vi.mock("@/components/dialogs/SendContractDialog", () => ({
  SendContractDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="dialog-contract" /> : null,
}));
vi.mock("@/components/dialogs/SendWelcomeDialog", () => ({
  SendWelcomeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="dialog-welcome" /> : null,
}));
vi.mock("@/components/dialogs/SendIntakeDialog", () => ({
  SendIntakeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="dialog-intake" /> : null,
}));
vi.mock("@/components/dialogs/TermsDialog", () => ({ TermsDialog: () => null }));
vi.mock("@/components/dialogs/SetUpPaymentsDialog", () => ({ SetUpPaymentsDialog: () => null }));
vi.mock("@/components/dialogs/RecordPaymentDialog", () => ({ RecordPaymentDialog: () => null }));
vi.mock("@/components/dialogs/BringAccountCurrentDialog", () => ({
  BringAccountCurrentDialog: () => null,
}));
vi.mock("@/components/dialogs/PaymentLedgerDialog", () => ({ PaymentLedgerDialog: () => null }));

import { Route as ClientRoute } from "./clients.$clientId";
import { Route as PaymentsRoute } from "./payments";

// --- Fixtures
const TAB_LABELS = [
  "Overview",
  "Program",
  "Billing",
  "Forms",
  "Contracts",
  "Documents",
  "Communications",
  "Monitoring",
  "Final Report",
  "Activity",
];

const client = {
  id: "c1",
  businessName: "Keep it Moving Construction LLC",
  primaryContactName: "Pat Doe",
  email: "pat@example.com",
  phone: "555-0100",
  status: "Active",
  assignedStaff: "Jordan",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  isArchived: false,
  programId: null, // legacy field: must not matter
  intake: { uploadedFiles: [] },
  socialLinks: [],
};
const programs = [
  { id: "p1", name: "The Inspired Detroit Initiative" },
  { id: "p2", name: "Grant Program" },
];
const enrollment = (id: string, programId: string) => ({
  id,
  clientId: "c1",
  programId,
  status: "active",
  organizationId: "org-1",
});

function seed({ enrollments }: { enrollments: ReturnType<typeof enrollment>[] }) {
  setState((state) => ({
    ...state,
    authStatus: "authenticated",
    bootstrapStatus: "ready",
    clients: [client as never],
    programs: programs as never,
    enrollments: enrollments as never,
    formTemplates: [
      { id: "f1", name: "Form P1", programId: "p1", fields: [] },
      { id: "f2", name: "Form P2", programId: "p2", fields: [] },
    ] as never,
    formAssignments: [
      { id: "a1", clientId: "c1", enrollmentId: "e1", formId: "f1", status: "draft" },
      { id: "a2", clientId: "c1", enrollmentId: "e2", formId: "f2", status: "draft" },
    ] as never,
    contracts: [
      {
        id: "k1",
        clientId: "c1",
        enrollmentId: "e1",
        contractType: "Contract P1",
        status: "SENT",
        generatedContent: "",
      },
      {
        id: "k2",
        clientId: "c1",
        enrollmentId: "e2",
        contractType: "Contract P2",
        status: "SENT",
        generatedContent: "",
      },
    ] as never,
    monitoring: [
      { id: "m1", enrollmentId: "e1", name: "Monitor P1", complianceStatus: "compliant" },
      { id: "m2", enrollmentId: "e2", name: "Monitor P2", complianceStatus: "compliant" },
    ] as never,
    terms: [],
    documents: [],
    communications: [],
    finalReports: [],
    activity: [],
    intakeSubmissions: [],
  }));
}

function mountRouter(initialUrl: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const clientRoute = ClientRoute.update({
    id: "/clients/$clientId",
    path: "/clients/$clientId",
    getParentRoute: () => rootRoute,
  } as never);
  const paymentsRoute = PaymentsRoute.update({
    id: "/payments",
    path: "/payments",
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([clientRoute, paymentsRoute]),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  });
  render(<RouterProvider router={router as never} />);
  return router as unknown as {
    state: { location: { pathname: string; search: Record<string, unknown> } };
    navigate: (opts: Record<string, unknown>) => Promise<void>;
  };
}

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);
const selectedTab = () =>
  screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.textContent;
const openTab = (label: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name: label }), { button: 0, ctrlKey: false });

beforeEach(() => {
  refreshClientProfile.mockResolvedValue(client);
  cfGetEnrollmentBillingSummary.mockResolvedValue({
    agreement: null,
    payments: [],
    collected: 0,
    expected: 0,
    outstanding: 0,
  });
  cfGetProgramBillingConfig.mockResolvedValue(null);
  cfGetBillingDashboard.mockResolvedValue({
    period: "month",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    revenue: { received: 0, expected: 0, outstanding: 0, activeRecurringRevenue: 0 },
    expectedPayments: [],
    needsBillingSetup: [
      {
        clientId: "c1",
        clientName: client.businessName,
        programId: "p1",
        programName: "The Inspired Detroit Initiative",
        enrollmentId: "e1",
        enrollmentDate: null,
      },
    ],
  });
});

afterEach(cleanup);

describe("canonical client profile: client with exactly one enrollment", () => {
  beforeEach(() => seed({ enrollments: [enrollment("e1", "p1")] }));

  it("View (no search) automatically selects the enrollment and normalizes the URL", async () => {
    const router = mountRouter("/clients/c1");
    await waitFor(() => expect(router.state.location.search.enrollmentId).toBe("e1"));
    expect(router.state.location.pathname).toBe("/clients/c1");
  });

  it("shows the ten canonical tabs including Billing", async () => {
    mountRouter("/clients/c1");
    await screen.findByRole("tab", { name: "Billing" });
    expect(tabNames()).toEqual(TAB_LABELS);
  });

  it("never shows 'No program assigned yet' and shows the one program without an assign prompt", async () => {
    mountRouter("/clients/c1");
    await screen.findByRole("tab", { name: "Billing" });
    expect(screen.queryByText(/No program assigned yet/)).toBeNull();
    expect(screen.queryByText("No program enrollment")).toBeNull();
    expect(screen.queryByText("Enroll client")).toBeNull();
    expect(screen.getAllByText("The Inspired Detroit Initiative").length).toBeGreaterThan(0);
    expect(screen.getByText("1 program enrollment")).toBeTruthy();
    expect(screen.queryByText("Working in:")).toBeNull(); // no selector for a single enrollment
  });

  it("fetches billing by (clientId, enrollmentId)", async () => {
    mountRouter("/clients/c1?tab=billing");
    await waitFor(() => expect(cfGetEnrollmentBillingSummary).toHaveBeenCalledWith("c1", "e1"));
    expect(await screen.findByText("Payment setup required")).toBeTruthy();
  });

  it("Payments → Set Up Payments lands on the same Billing tab and enrollment as the profile", async () => {
    const router = mountRouter("/payments");
    fireEvent.click(await screen.findByRole("link", { name: "Set Up Payments" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/clients/c1"));
    expect(router.state.location.search).toMatchObject({ enrollmentId: "e1", tab: "billing" });
    expect(router.state.location.search.programId).toBeUndefined();
    expect(await screen.findByText("Payment setup required")).toBeTruthy();
    expect(selectedTab()).toBe("Billing");
    expect(cfGetEnrollmentBillingSummary).toHaveBeenLastCalledWith("c1", "e1");
    expect(tabNames()).toEqual(TAB_LABELS); // the very same shell as View

    // ...and direct View resolves to the identical enrollment.
    await act(async () => {
      await router.navigate({ to: "/clients/$clientId", params: { clientId: "c1" }, search: {} });
    });
    await waitFor(() => expect(router.state.location.search.enrollmentId).toBe("e1"));
  });

  it("keeps the selected tab and enrollment in the URL when switching tabs", async () => {
    const router = mountRouter("/clients/c1");
    await screen.findByRole("tab", { name: "Contracts" });
    openTab("Contracts");
    await waitFor(() => expect(router.state.location.search.tab).toBe("contracts"));
    expect(router.state.location.search.enrollmentId).toBe("e1");
    expect(selectedTab()).toBe("Contracts");
  });

  it("normalizes a legacy ?programId= link to the enrollment and removes programId", async () => {
    const router = mountRouter("/clients/c1?programId=p1&tab=billing");
    await waitFor(() => expect(router.state.location.search.enrollmentId).toBe("e1"));
    expect(router.state.location.search.programId).toBeUndefined();
    expect(router.state.location.search.tab).toBe("billing");
  });
});

describe("canonical client profile: client with several enrollments", () => {
  beforeEach(() => seed({ enrollments: [enrollment("e1", "p1"), enrollment("e2", "p2")] }));

  it("shows the Working in selector and defaults to the first active enrollment", async () => {
    const router = mountRouter("/clients/c1");
    expect(await screen.findByText("Working in:")).toBeTruthy();
    expect(screen.getByText("1 other enrollment")).toBeTruthy();
    await waitFor(() => expect(router.state.location.search.enrollmentId).toBe("e1"));
    expect(screen.queryByText(/No program assigned yet/)).toBeNull();
  });

  it("changing the selected enrollment changes every enrollment-scoped tab consistently", async () => {
    const router = mountRouter("/clients/c1?enrollmentId=e1&tab=forms");

    // Forms
    expect(await screen.findByText("Form P1")).toBeTruthy();
    expect(screen.queryByText("Form P2")).toBeNull();
    await waitFor(() => expect(cfGetEnrollmentBillingSummary).toHaveBeenCalledWith("c1", "e1"));

    await act(async () => {
      await router.navigate({
        to: "/clients/$clientId",
        params: { clientId: "c1" },
        search: (prev: Record<string, unknown>) => ({ ...prev, enrollmentId: "e2" }),
      });
    });

    expect(await screen.findByText("Form P2")).toBeTruthy();
    expect(screen.queryByText("Form P1")).toBeNull();
    expect(selectedTab()).toBe("Forms"); // the tab does not change with the enrollment

    // Billing follows the same enrollment
    await waitFor(() => expect(cfGetEnrollmentBillingSummary).toHaveBeenLastCalledWith("c1", "e2"));

    // Contracts
    openTab("Contracts");
    expect(await screen.findByText("Contract P2")).toBeTruthy();
    expect(screen.queryByText("Contract P1")).toBeNull();

    // Monitoring
    openTab("Monitoring");
    expect(await screen.findByText("Monitor P2")).toBeTruthy();
    expect(screen.queryByText("Monitor P1")).toBeNull();

    // Program tab shows the selected program
    openTab("Program");
    await waitFor(() => expect(selectedTab()).toBe("Program"));
    const programPanel = screen.getByRole("tabpanel");
    expect(within(programPanel).getByText("Grant Program")).toBeTruthy();

    expect(router.state.location.search.enrollmentId).toBe("e2");
  });

  it("picking a program in the Working in selector updates the URL and the visible tab content", async () => {
    // Radix Select relies on pointer APIs jsdom lacks.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => undefined;
    Element.prototype.setPointerCapture ??= () => undefined;
    Element.prototype.scrollIntoView ??= () => undefined;

    const router = mountRouter("/clients/c1?enrollmentId=e1&tab=contracts");
    expect(await screen.findByText("Contract P1")).toBeTruthy();

    const trigger = screen.getByRole("combobox", { name: "Working in program" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Grant Program/ }));

    await waitFor(() => expect(router.state.location.search.enrollmentId).toBe("e2"));
    expect(router.state.location.search.tab).toBe("contracts");
    expect(await screen.findByText("Contract P2")).toBeTruthy();
    expect(screen.queryByText("Contract P1")).toBeNull();
  });

  it("a refresh (fresh mount at the same URL) keeps the selected enrollment and tab", async () => {
    cleanup();
    const router = mountRouter("/clients/c1?enrollmentId=e2&tab=contracts");
    expect(await screen.findByText("Contract P2")).toBeTruthy();
    expect(screen.queryByText("Contract P1")).toBeNull();
    expect(router.state.location.search).toMatchObject({ enrollmentId: "e2", tab: "contracts" });
  });

  it("falls back to a valid enrollment when the URL names one that isn't this client's", async () => {
    const router = mountRouter("/clients/c1?enrollmentId=not-mine");
    await waitFor(() => expect(router.state.location.search.enrollmentId).toBe("e1"));
  });
});

describe("canonical client profile: client with no enrollments", () => {
  beforeEach(() => seed({ enrollments: [] }));

  it("shows the enrollment prompt (and only here), keeps all ten tabs, and explains program tabs", async () => {
    const router = mountRouter("/clients/c1?tab=billing");
    expect(await screen.findByText("No program enrollment")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enroll client" })).toBeTruthy();
    expect(tabNames()).toEqual(TAB_LABELS);
    expect(
      await screen.findByText("Enroll this client in a program to use this tab."),
    ).toBeTruthy();
    expect(cfGetEnrollmentBillingSummary).not.toHaveBeenCalled();
    expect(router.state.location.search.enrollmentId).toBeUndefined();
  });
});

describe("one Send workflow in the client header", () => {
  const openSendMenu = () =>
    fireEvent.keyDown(screen.getByRole("button", { name: /^Send$/ }), { key: "Enter" });
  const menuItem = (name: RegExp) => screen.getByRole("menuitem", { name });
  const isDisabled = (el: HTMLElement) =>
    el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled");

  it("the header is just Edit client | Send | Move to archive", async () => {
    seed({ enrollments: [enrollment("e1", "p1")] });
    mountRouter("/clients/c1");
    await screen.findByRole("tab", { name: "Billing" });

    expect(screen.getByRole("button", { name: "Edit client" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Send$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move to archive" })).toBeTruthy();

    // The old standalone header actions are gone.
    for (const name of [
      "Create terms",
      "Generate contract",
      "Schedule follow-up",
      "Resend intake email",
      "Send program form",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("one enrollment: every send action is available and opens the matching dialog", async () => {
    seed({ enrollments: [enrollment("e1", "p1")] });
    mountRouter("/clients/c1");
    await screen.findByRole("tab", { name: "Billing" });

    const cases: [RegExp, string][] = [
      [/Send \/ resend intake/, "dialog-intake"],
      [/Send program form/, "dialog-form-program"],
      [/Send general form/, "dialog-form-general"],
      [/Send contract/, "dialog-contract"],
      [/Send \/ resend welcome email/, "dialog-welcome"],
    ];
    for (const [label, dialog] of cases) {
      openSendMenu();
      expect(isDisabled(menuItem(label))).toBe(false);
      fireEvent.click(menuItem(label));
      expect(await screen.findByTestId(dialog)).toBeTruthy();
    }
  });

  it("zero enrollments: program-specific sends are disabled with the reason; intake and general forms still work", async () => {
    seed({ enrollments: [] });
    mountRouter("/clients/c1");
    await screen.findByRole("tab", { name: "Billing" });

    openSendMenu();
    expect(isDisabled(menuItem(/Send program form/))).toBe(true);
    expect(isDisabled(menuItem(/Send contract/))).toBe(true);
    expect(isDisabled(menuItem(/Send \/ resend welcome email/))).toBe(true);
    expect(
      screen.getByText("Assign the client to a program before sending program-specific materials."),
    ).toBeTruthy();
    expect(isDisabled(menuItem(/Send \/ resend intake/))).toBe(false);
    expect(isDisabled(menuItem(/Send general form/))).toBe(false);

    fireEvent.click(menuItem(/Send general form/));
    expect(await screen.findByTestId("dialog-form-general")).toBeTruthy();
  });

  it("the Forms tab has the same sending center, above the assigned-forms history", async () => {
    seed({ enrollments: [enrollment("e1", "p1")] });
    mountRouter("/clients/c1?enrollmentId=e1&tab=forms");

    expect(await screen.findByText("Send something to this client")).toBeTruthy();
    for (const name of ["Program Form", "General Form", "Contract", "Welcome Email"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
    }
    expect(screen.getByText("Form P1")).toBeTruthy(); // history is preserved

    fireEvent.click(screen.getByRole("button", { name: "Contract" }));
    expect(await screen.findByTestId("dialog-contract")).toBeTruthy();
  });

  it("the Forms tab panel follows the zero-enrollment rules too", async () => {
    seed({ enrollments: [] });
    mountRouter("/clients/c1?tab=forms");
    await screen.findByText("Send something to this client");
    expect(
      (screen.getByRole("button", { name: "General Form" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Program Form" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Welcome Email" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("relocated actions: terms live on the Program tab, contracts on Contracts, follow-up on Overview", async () => {
    seed({ enrollments: [enrollment("e1", "p1")] });
    mountRouter("/clients/c1?enrollmentId=e1&tab=program");
    expect(await screen.findByRole("button", { name: "Create terms" })).toBeTruthy();

    openTab("Contracts");
    await waitFor(() => expect(selectedTab()).toBe("Contracts"));
    // The seeded contract was already sent, so the action is a resend (not a new draft).
    expect(screen.getByText("Sent, waiting for a signature")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generate contract" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Resend signing link" })[0]);
    expect(await screen.findByTestId("dialog-contract")).toBeTruthy();

    openTab("Overview");
    await waitFor(() => expect(selectedTab()).toBe("Overview"));
    expect(screen.getByRole("button", { name: "Schedule follow-up (7 days)" })).toBeTruthy();
  });

  it("Contracts tab offers Send copy (not the signing link) for a signed contract", async () => {
    seed({ enrollments: [enrollment("e1", "p1")] });
    setState((state) => ({
      ...state,
      contracts: [
        {
          id: "k1",
          clientId: "c1",
          enrollmentId: "e1",
          contractType: "Contract P1",
          status: "COMPLETED",
          signedAt: "2026-09-20T00:00:00.000Z",
          executedStoredFileId: "f1",
          generatedContent: "",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ] as never,
    }));
    mountRouter("/clients/c1?enrollmentId=e1&tab=contracts");

    const copyButtons = await screen.findAllByRole("button", { name: "Send copy" });
    expect(copyButtons.length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Resend signing link" })).toBeNull();
    fireEvent.click(copyButtons[0]);
    expect(await screen.findByTestId("dialog-contract")).toBeTruthy();
  });
});

describe("client saved with an empty intake", () => {
  // The API creates clients with `intake: {}`, so intake fields (even uploadedFiles) can be missing.
  beforeEach(() => {
    seed({ enrollments: [enrollment("e1", "p1")] });
    setState((state) => ({ ...state, clients: [{ ...client, intake: {} } as never] }));
  });

  it.each(["overview", "program"])("renders the %s tab instead of crashing", async (tab) => {
    mountRouter(`/clients/c1?enrollmentId=e1&tab=${tab}`);
    expect(await screen.findByText("Keep it Moving Construction LLC")).toBeTruthy();
    expect(tabNames()).toEqual(TAB_LABELS);
  });
});
