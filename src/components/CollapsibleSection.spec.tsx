import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { validationErrorProps } from "@/lib/section-markers";
import { useOpenSections } from "@/lib/use-open-sections";
import { CollapsibleSection, UnsavedChangesMarker } from "./CollapsibleSection";

afterEach(cleanup);

const toggle = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
/** Closed sections keep their content mounted (so edits survive) but hidden. */
const isShown = (text: string) => !screen.getByText(text).closest("[hidden]");

/** An editor that can show a validation error and tracks unsaved text, like the program editors. */
function Editor({ saved = "" }: { saved?: string }) {
  const [text, setText] = useState(saved);
  return (
    <div>
      <input
        aria-label="Signature"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {text.includes("{{nope}}") && <p {...validationErrorProps}>Unknown merge field</p>}
      {text !== saved && <UnsavedChangesMarker />}
    </div>
  );
}

describe("CollapsibleSection", () => {
  it("shows the summary while closed and the content once opened", () => {
    render(
      <CollapsibleSection title="Billing" summary="$100.00 · monthly · Billing active">
        <p>Billing form</p>
      </CollapsibleSection>,
    );
    expect(toggle("Billing").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("$100.00 · monthly · Billing active")).toBeTruthy();
    expect(isShown("Billing form")).toBe(false);

    fireEvent.click(toggle("Billing"));
    expect(toggle("Billing").getAttribute("aria-expanded")).toBe("true");
    expect(isShown("Billing form")).toBe(true);
    expect(screen.queryByText("$100.00 · monthly · Billing active")).toBeNull();
  });

  it("keeps unsaved edits when closed and reopened, and says so while closed", async () => {
    render(
      <CollapsibleSection title="Email signature" summary="Organization's signature" defaultOpen>
        <Editor />
      </CollapsibleSection>,
    );
    fireEvent.change(screen.getByLabelText("Signature"), { target: { value: "Warm regards" } });
    fireEvent.click(toggle("Email signature"));
    expect(await screen.findByText("Unsaved changes.")).toBeTruthy();

    fireEvent.click(toggle("Email signature"));
    expect((screen.getByLabelText("Signature") as HTMLInputElement).value).toBe("Warm regards");
  });

  it("opens itself, and the section around it, when a validation error appears", async () => {
    function Page() {
      const [error, setError] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setError(true)}>
            Make an error
          </button>
          <CollapsibleSection title="Program workflow">
            <CollapsibleSection title="Agreements" variant="nested">
              {error && <p {...validationErrorProps}>Not available in enrollment agreements</p>}
            </CollapsibleSection>
          </CollapsibleSection>
        </>
      );
    }
    render(<Page />);
    expect(toggle("Program workflow").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Make an error" }));
    await waitFor(() =>
      expect(toggle("Program workflow").getAttribute("aria-expanded")).toBe("true"),
    );
    expect(toggle("Agreements").getAttribute("aria-expanded")).toBe("true");
    expect(isShown("Not available in enrollment agreements")).toBe(true);
  });

  it("lets several sections be open at once", () => {
    render(
      <>
        <CollapsibleSection title="Client journey">
          <p>Journey editor</p>
        </CollapsibleSection>
        <CollapsibleSection title="Required documents">
          <p>Documents editor</p>
        </CollapsibleSection>
      </>,
    );
    fireEvent.click(toggle("Client journey"));
    fireEvent.click(toggle("Required documents"));
    expect(isShown("Journey editor")).toBe(true);
    expect(isShown("Documents editor")).toBe(true);
  });
});

describe("useOpenSections", () => {
  it("opens a section and the section it sits in, leaving others as they were", () => {
    const { result } = renderHook(() => useOpenSections({ "welcome-email": "program-workflow" }));
    act(() => result.current.setOpen("billing", true));
    act(() => result.current.reveal("welcome-email"));
    expect(result.current.isOpen("welcome-email")).toBe(true);
    expect(result.current.isOpen("program-workflow")).toBe(true);
    expect(result.current.isOpen("billing")).toBe(true);
    expect(result.current.isOpen("agreements")).toBe(false);
  });
});
