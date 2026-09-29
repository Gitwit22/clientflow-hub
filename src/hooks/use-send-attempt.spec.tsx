import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSendAttempt } from "./use-send-attempt";

const serverError = () => Object.assign(new Error("rejected"), { status: 503 });
const networkError = () => new TypeError("Failed to fetch");

describe("useSendAttempt", () => {
  it("gives a deliberate resend a new key after a successful send", async () => {
    const { result } = renderHook(() => useSendAttempt());
    const keys: string[] = [];
    await act(async () => void (await result.current.run(async (key) => keys.push(key))));
    await act(async () => void (await result.current.run(async (key) => keys.push(key))));
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("reuses the key when the response was lost, so a retry cannot email twice", async () => {
    const { result } = renderHook(() => useSendAttempt());
    const keys: string[] = [];
    await act(async () => {
      await result.current
        .run(async (key) => {
          keys.push(key);
          throw networkError();
        })
        .catch(() => undefined);
    });
    await act(async () => void (await result.current.run(async (key) => keys.push(key))));
    expect(keys[0]).toBe(keys[1]);
  });

  it("uses a fresh key after the server answered with a failure", async () => {
    const { result } = renderHook(() => useSendAttempt());
    const keys: string[] = [];
    await act(async () => {
      await result.current
        .run(async (key) => {
          keys.push(key);
          throw serverError();
        })
        .catch(() => undefined);
    });
    await act(async () => void (await result.current.run(async (key) => keys.push(key))));
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("ignores a second click while a send is running", async () => {
    const { result } = renderHook(() => useSendAttempt());
    let release!: () => void;
    const action = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("done");
        }),
    );

    let first!: Promise<string | undefined>;
    let second!: Promise<string | undefined>;
    act(() => {
      first = result.current.run(action);
      second = result.current.run(action);
    });
    expect(result.current.sending).toBe(true);
    await act(async () => {
      release();
      await first;
    });

    expect(await second).toBeUndefined();
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.sending).toBe(false);
  });

  it("propagates the error so the dialog can show it", async () => {
    const { result } = renderHook(() => useSendAttempt());
    await expect(
      act(async () => {
        await result.current.run(async () => {
          throw serverError();
        });
      }),
    ).rejects.toThrow("rejected");
    expect(result.current.sending).toBe(false);
  });
});
