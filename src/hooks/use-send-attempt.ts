import { useCallback, useRef, useState } from "react";
import { isDefinitiveFailure, newIdempotencyKey } from "@/lib/client-send";

/**
 * Runs one "send something to the client" action with an idempotency key.
 *
 * The key is created on the first click and reused only while the outcome is unknown (the request
 * was lost). Once the server has answered, successfully or not, the attempt is over and the next
 * click is a new attempt with a new key, so a deliberate resend always sends. While a send is
 * running, further clicks are ignored.
 */
export function useSendAttempt() {
  const key = useRef<string | null>(null);
  const running = useRef(false);
  const [sending, setSending] = useState(false);

  const run = useCallback(
    async <T>(action: (idempotencyKey: string) => Promise<T>): Promise<T | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      setSending(true);
      key.current ??= newIdempotencyKey();
      try {
        const result = await action(key.current);
        key.current = null; // the server answered: the next click is a new attempt
        return result;
      } catch (error) {
        if (isDefinitiveFailure(error)) key.current = null;
        throw error;
      } finally {
        running.current = false;
        setSending(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    key.current = null;
  }, []);

  return { run, sending, reset };
}
