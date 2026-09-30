import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Runs a button's server call with a busy state and an error toast, and ignores clicks while one is
 * in flight (so a double click can't send twice). `busy` holds the key of the running action, so a
 * list can disable just the row being changed.
 */
export function useAsyncAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (
      key: string,
      action: () => Promise<unknown>,
      options: { success?: string; error: string },
    ): Promise<boolean> => {
      if (running.current) return false;
      running.current = true;
      setBusy(key);
      try {
        await action();
        if (options.success) toast.success(options.success);
        return true;
      } catch (error) {
        toast.error(error instanceof Error && error.message ? error.message : options.error);
        return false;
      } finally {
        running.current = false;
        setBusy(null);
      }
    },
    [],
  );

  return { busy, run };
}
