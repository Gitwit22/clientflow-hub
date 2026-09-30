import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useAsyncAction } from "./use-async-action";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("useAsyncAction", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("marks the action busy while it runs and reports success", async () => {
    let finish!: () => void;
    const { result } = renderHook(() => useAsyncAction());
    let done!: Promise<boolean>;
    act(() => {
      done = result.current.run("row-1", () => new Promise<void>((resolve) => (finish = resolve)), {
        success: "Saved",
        error: "Failed",
      });
    });
    expect(result.current.busy).toBe("row-1");
    await act(async () => {
      finish();
      expect(await done).toBe(true);
    });
    expect(result.current.busy).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Saved");
  });

  it("ignores a second click while the first is running", async () => {
    const action = vi.fn(() => new Promise<void>(() => undefined));
    const { result } = renderHook(() => useAsyncAction());
    act(() => {
      void result.current.run("a", action, { error: "x" });
    });
    let second!: boolean;
    await act(async () => {
      second = await result.current.run("a", action, { error: "x" });
    });
    expect(second).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("shows the server's message, or the fallback, when it fails", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run("a", () => Promise.reject(new Error("Form already submitted.")), {
        error: "Unable to cancel.",
      });
      await result.current.run("a", () => Promise.reject("boom"), { error: "Unable to cancel." });
    });
    expect(toast.error).toHaveBeenNthCalledWith(1, "Form already submitted.");
    expect(toast.error).toHaveBeenNthCalledWith(2, "Unable to cancel.");
    expect(result.current.busy).toBeNull();
  });
});
