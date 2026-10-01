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
const downloadExecutedContract = vi.fn();
const sendSignedAgreementCopy = vi.fn();

vi.mock("@/lib/api", () => ({
  addCommunication: vi.fn(),
  archiveClient: vi.fn(),
  cancelFormAssignment: vi.fn(),
  createEnrollment: (...args: unknown[]) => createEnrollment(...args),
  createEnrollmentMonitoring: vi.fn(),
  createFinalReport: vi.fn(),
  downloadDocument: vi.fn(),
  downloadExecutedContract: (...args: unknown[]) => downloadExecutedContract(...args),
  sendSignedAgreementCopy: (...args: unknown[]) => sendSignedAgreementCopy(...args),
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

  it("shows the nine canonical tabs including Billing", async () => {
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
    await screen.findByRole("tab", { name: "Documents" });
    openTab("Documents");
    await waitFor(() => expect(router.state.location.search.tab).toBe("documents"));
    expect(router.state.location.search.enrollmentId).toBe("e1");
    expect(selectedTab()).toBe("Documents");
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

    const router = mountRouter("/clients/c1?enrollmentId=e1&tab=forms");
    expect(await screen.findByText("Form P1")).toBeTruthy();

    const trigger = screen.getByRole("combobox", { name: "Working in program" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Grant Program/ }));

    await waitFor(() => expect(router.state.location.search.enrollmentId).toBe("e2"));
    expect(router.state.location.search.tab).toBe("forms");
    expect(await screen.findByText("Form P2")).toBeTruthy();
    expect(screen.queryByText("Form P1")).toBeNull();
  });

  it("a refresh (fresh mount at the same URL) keeps the selected enrollment and tab", async () => {
    cleanup();
    const router = mountRouter("/clients/c1?enrollmentId=e2&tab=forms");
    expect(await screen.findByText("Form P2")).toBeTruthy();
    expect(screen.queryByText("Form P1")).toBeNull();
    expect(router.state.location.search).toMatchObject({ enrollmentId: "e2", tab: "forms" });
  });

  it("an old Contracts link opens the Documents tab", async () => {
    cleanup();
    mountRouter("/clients/c1?enrollmentId=e2&tab=contracts");
    await waitFor(() => expect(selectedTab()).toBe("Documents"));
  });

  it("falls back to a valid enrollment when the URL names one that isn't this client's", async () => {
    const router = mountRouter("/clients/c1?enrollmentId=not-mine");
    await waitFor(() => expect(router.state.location.search.enrollmentId).toBe("e1"));
  });
});

describe("canonical client profile: client with no enrollments", () => {
  beforeEach(() => seed({ enrollments: [] }));

  it("shows the enrollment prompt (and only here), keeps all nine tabs, and explains program tabs", async () => {
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

  it("the Forms tab offers every send action and groups forms by kind", async () => {
    seed({ enrollments: [enrollment("e1", "p1")] });
    mountRouter("/clients/c1?enrollmentId=e1&tab=forms");

    expect(await screen.findByText("Form P1")).toBeTruthy();
    expect(screen.getByText("Master Intake")).toBeTruthy();
    expect(screen.getByText("Program forms")).toBeTruthy();
    expect(screen.getByText("Send to client")).toBeTruthy();
    for (const name of [
      "Send / resend intake",
      "Send program form",
      "Send general form",
      "Send contract",
      "Send / resend welcome email",
    ]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("the Master Intake card is the read-only record: submitted answers, Review answers and Edit client", async () => {
    seed({ enrollments: [enrollment("e1", "p1")] });
    setState((state) => ({
      ...state,
      formTemplates: [
        ...state.formTemplates,
        { id: "intake", name: "Master Intake", fields: [] },
      ] as never,
      formAssignments: [
        ...state.formAssignments,
        {
          id: "ia",
          clientId: "c1",
          formId: "intake",
          status: "submitted",
          submittedAt: "2026-02-01T12:00:00.000Z",
        },
      ] as never,
      intakeSubmissions: [
        {
          id: "s1",
          clientId: "c1",
          formAssignmentId: "ia",
          submittedAt: "2026-02-01T12:00:00.000Z",
          responsePayload: { email: "sent@example.com", "brief-business-description": "Bakery" },
          resultPayload: {},
          programs: [],
          snapshot: {
            selectedProgramIds: [],
            renderedSections: [
              {
                id: "core",
                kind: "core",
                fields: [
                  { id: "email", label: "Email", type: "email" },
                  {
                    id: "brief-business-description",
                    label: "Brief business description",
                    type: "textarea",
                  },
                ],
              },
            ],
          },
        },
      ] as never,
    }));
    mountRouter("/clients/c1?enrollmentId=e1&tab=forms");

    expect(
      await screen.findByText(/submitted on .*To correct client details, use Edit client\./),
    ).toBeTruthy();
    expect(screen.getByText("sent@example.com")).toBeTruthy();
    expect(screen.getByText("Bakery")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review answers" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Edit client/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("an empty Forms tab points to the send buttons", async () => {
    seed({ enrollments: [] });
    setState((state) => ({ ...state, formAssignments: [] }));
    mountRouter("/clients/c1?tab=forms");
    expect(await screen.findByText(/Send one with Send to client above/)).toBeTruthy();
  });

  it("Program owns the enrollment and its pending agreement; Overview owns follow-up", async () => {
    seed({ enrollments: [enrollment("e1", "p1")] });
    mountRouter("/clients/c1?enrollmentId=e1&tab=program");
    expect(await screen.findByRole("button", { name: "Create terms" })).toBeTruthy();
    // The seeded contract was already sent, so the agreement action is a resend.
    expect(screen.getByText("Sent, waiting for a signature")).toBeTruthy();
    // Intake answers live in Forms, not here.
    expect(screen.queryByText("Master intake answers")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resend signing link" }));
    expect(await screen.findByTestId("dialog-contract")).toBeTruthy();

    openTab("Overview");
    await waitFor(() => expect(selectedTab()).toBe("Overview"));
    expect(screen.getByRole("button", { name: "Schedule in 7 days" })).toBeTruthy();
    expect(screen.getByText("Recent activity")).toBeTruthy();
  });

  it("a signed agreement is a document: View, Download and Send copy on the Documents tab", async () => {
    seed({ enrollments: [enrollment("e1", "p1")] });
    setState((state) => ({
      ...state,
      contracts: [
        {
          id: "k1",
          clientId: "c1",
          enrollmentId: "e1",
          programId: "p1",
          contractType: "Membership Agreement",
          status: "COMPLETED",
          signedAt: "2026-09-29T12:00:00.000Z",
          executedStoredFileId: "f1",
          generatedContent: "",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ] as never,
    }));
    downloadExecutedContract.mockResolvedValue(undefined);
    sendSignedAgreementCopy.mockResolvedValue({ status: "sent" });
    mountRouter("/clients/c1?enrollmentId=e1&tab=documents");

    expect(await screen.findByText("Membership Agreement")).toBeTruthy();
    expect(screen.getByText("Signed agreements")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(downloadExecutedContract).toHaveBeenLastCalledWith("c1", "k1", { view: true });
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(downloadExecutedContract).toHaveBeenLastCalledWith("c1", "k1");
    fireEvent.click(screen.getByRole("button", { name: "Send copy" }));
    await waitFor(() => expect(sendSignedAgreementCopy).toHaveBeenCalledWith("c1", "k1"));

    // Program points at it instead of repeating it.
    openTab("Program");
    expect(await screen.findByRole("button", { name: "View in Documents" })).toBeTruthy();
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
