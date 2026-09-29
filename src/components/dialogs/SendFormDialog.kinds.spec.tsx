import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, ProgramEnrollment } from "@/types";
import { SendFormDialog } from "./SendFormDialog";

const createFormAssignment = vi.fn();
const sendFormEmail = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/api", () => ({
  createFormAssignment: (...a: unknown[]) => createFormAssignment(...a),
  renderEmailBody: () => "Email body",
  sendFormEmail: (...a: unknown[]) => sendFormEmail(...a),
}));

vi.mock("@/lib/store", () => ({
  useAppState: () => ({
    formTemplates: [
      {
        id: "form-master",
        name: "Master Intake",
        isActive: true,
        scope: "master_core",
        programId: null,
      },
      {
        id: "form-general",
        name: "General Feedback Form",
        isActive: true,
        scope: "legacy",
        programId: null,
      },
      {
        id: "form-p1",
        name: "Inspired Detroit Questions",
        isActive: true,
        scope: "program_section",
        programId: "p1",
      },
      {
        id: "form-p2",
        name: "Grant Questions",
        isActive: true,
        scope: "program_section",
        programId: "p2",
      },
    ],
    programs: [
      { id: "p1", name: "The Inspired Detroit Initiative" },
      { id: "p2", name: "Grant Program" },
    ],
    enrollments: [],
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

const client = {
  id: "client-1",
  primaryContactName: "Jordan Lee",
  businessName: "North Star",
  email: "jordan@example.com",
  phone: "555",
  assignedUserId: "admin-1",
  intake: { programOfInterest: "" },
} as Client;
const enrollment = {
  id: "e1",
  programId: "p1",
  clientId: "client-1",
  status: "active",
} as ProgramEnrollment;
const sent = {
  success: true,
  status: "SENT",
  message: "Email accepted for delivery",
  provider: "N8N_GMAIL",
  recipientEmail: "jordan@example.com",
};

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  createFormAssignment.mockResolvedValue({ id: "assignment-1" });
  sendFormEmail.mockResolvedValue(sent);
});
afterEach(cleanup);

describe("SendFormDialog: program form", () => {
  it("sends the form for the SELECTED enrollment's program and ties the assignment to that enrollment", async () => {
    render(
      <SendFormDialog
        client={client}
        kind="program"
        enrollment={enrollment}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Send program form")).toBeTruthy();
    expect(
      (screen.getByDisplayValue("Inspired Detroit Questions") as HTMLInputElement).readOnly,
    ).toBe(true);

    fireEvent.click(button("Send form"));

    await waitFor(() => expect(sendFormEmail).toHaveBeenCalledTimes(1));
    expect(createFormAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "client-1", formId: "form-p1", enrollmentId: "e1" }),
    );
    expect(sendFormEmail).toHaveBeenCalledWith(
      "assignment-1",
      undefined,
      expect.stringMatching(/^[A-Za-z0-9._:-]{8,128}$/),
    );
  });

  it("never offers another program's form or a general form", () => {
    render(
      <SendFormDialog
        client={client}
        kind="program"
        enrollment={enrollment}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.queryByDisplayValue("Grant Questions")).toBeNull();
    expect(screen.queryByDisplayValue("Master Intake")).toBeNull();
  });

  it("explains when the program has no active form, and cannot send", () => {
    render(
      <SendFormDialog
        client={client}
        kind="program"
        enrollment={{ ...enrollment, programId: "p-without-forms" }}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/No active form is configured for/)).toBeTruthy();
    expect(button("Send form").disabled).toBe(true);
  });

  it("cannot send a program form without an enrollment", () => {
    render(
      <SendFormDialog
        client={client}
        kind="program"
        enrollment={null}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(button("Send form").disabled).toBe(true);
    expect(createFormAssignment).not.toHaveBeenCalled();
  });
});

describe("SendFormDialog: general form", () => {
  it("sends a form that is not tied to a program, with no enrollment", async () => {
    render(<SendFormDialog client={client} kind="general" open onOpenChange={vi.fn()} />);

    expect(screen.getByText("Send general form")).toBeTruthy();
    fireEvent.click(button("Send form"));

    await waitFor(() => expect(sendFormEmail).toHaveBeenCalledTimes(1));
    const data = createFormAssignment.mock.calls[0][0] as Record<string, unknown>;
    expect(data.formId).toBe("form-master"); // the master intake is listed first
    expect(data).not.toHaveProperty("enrollmentId");
  });

  it("never offers a program's form", () => {
    render(<SendFormDialog client={client} kind="general" open onOpenChange={vi.fn()} />);
    expect(screen.queryByText("Inspired Detroit Questions")).toBeNull();
  });
});

describe("SendFormDialog: failures", () => {
  it("shows the error, stays open, and a server error makes the next click a new attempt", async () => {
    sendFormEmail.mockRejectedValueOnce(
      Object.assign(new Error("Email delivery is unavailable."), { status: 503 }),
    );
    const onOpenChange = vi.fn();
    render(
      <SendFormDialog
        client={client}
        kind="program"
        enrollment={enrollment}
        open
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(button("Send form"));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Email delivery is unavailable."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    fireEvent.click(button("Send form"));
    await waitFor(() => expect(sendFormEmail).toHaveBeenCalledTimes(2));
    // The assignment created by the first click is reused rather than duplicated.
    expect(createFormAssignment).toHaveBeenCalledTimes(1);
    const keys = sendFormEmail.mock.calls.map((call) => call[2] as string);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("after a lost response the retry reuses the same key, so the client is not emailed twice", async () => {
    sendFormEmail.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(
      <SendFormDialog
        client={client}
        kind="program"
        enrollment={enrollment}
        open
        onOpenChange={vi.fn()}
      />,
    );

    fireEvent.click(button("Send form"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    fireEvent.click(button("Send form"));
    await waitFor(() => expect(sendFormEmail).toHaveBeenCalledTimes(2));

    const keys = sendFormEmail.mock.calls.map((call) => call[2] as string);
    expect(keys[0]).toBe(keys[1]);
  });
});
