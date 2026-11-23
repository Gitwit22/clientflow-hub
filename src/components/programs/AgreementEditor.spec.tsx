import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgreementEditor } from "./AgreementEditor";

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <AgreementEditor value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const textarea = () => screen.getByLabelText("Agreement text") as HTMLTextAreaElement;
const select = (start: number, end: number) => {
  textarea().setSelectionRange(start, end);
  fireEvent.select(textarea());
};
const value = () => screen.getByTestId("value").textContent;

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

describe("AgreementEditor", () => {
  it("bolds, italicises and underlines the selected words", () => {
    render(<Harness initial="Pay within 30 days." />);
    select(4, 10);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(value()).toBe("Pay **within** 30 days.");

    select(0, 3);
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    expect(value()).toBe("_Pay_ **within** 30 days.");

    select(value()!.indexOf("30"), value()!.indexOf("30") + 2);
    fireEvent.click(screen.getByRole("button", { name: "Underline" }));
    expect(value()).toBe("_Pay_ **within** ++30++ days.");
  });

  it("makes lists and centers a line", () => {
    render(<Harness initial={"Attend meetings\nKeep records"} />);
    select(0, 28);
    fireEvent.click(screen.getByRole("button", { name: "Bulleted list" }));
    expect(value()).toBe("- Attend meetings\n- Keep records");

    select(0, 0);
    fireEvent.click(screen.getByRole("button", { name: "Center" }));
    expect(value()?.split("\n")[0]).toBe("->- Attend meetings<-");
  });

  it("points out formatting that isn't closed", () => {
    render(<Harness initial="This **is open" />);
    expect(screen.getByText(/Bold text on line 1 isn.t closed/)).toBeTruthy();
  });
});
