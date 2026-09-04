import { useEffect, useRef, useState } from "react";
import { logout } from "@/lib/apiClient";
import {
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
  LAST_ACTIVITY_STORAGE_KEY,
  LOGOUT_STORAGE_KEY,
  getLastActivityAt,
  parseActivityTimestamp,
  recordActivity,
} from "@/lib/idle-session";
import { clearAuthSession } from "@/lib/store";

const ACTIVITY_WRITE_THROTTLE_MS = 1000;

export function useIdleLogout() {
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(
    Math.ceil((IDLE_TIMEOUT_MS - IDLE_WARNING_MS) / 1000),
  );
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const lastActivityAtRef = useRef(Date.now());
  const lastPersistedAtRef = useRef(0);
  const warningOpenRef = useRef(false);
  const logoutRequestedRef = useRef(false);
  const reevaluateRef = useRef<() => void>(() => undefined);

  function updateWarning(open: boolean) {
    warningOpenRef.current = open;
    setWarningOpen(open);
  }

  async function performLogout() {
    if (logoutRequestedRef.current) return;
    logoutRequestedRef.current = true;
    setIsLoggingOut(true);
    try {
      await logout();
    } catch {
      // The logout helper still clears local and cross-tab session state.
    } finally {
      window.location.assign("/login");
    }
  }

  function continueSession() {
    if (logoutRequestedRef.current) return;
    const now = recordActivity();
    lastActivityAtRef.current = now;
    lastPersistedAtRef.current = now;
    updateWarning(false);
    reevaluateRef.current();
  }

  useEffect(() => {
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let countdownTimer: ReturnType<typeof setInterval> | undefined;

    const clearTimers = () => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (countdownTimer) clearInterval(countdownTimer);
      deadlineTimer = undefined;
      countdownTimer = undefined;
    };

    const requestLogout = () => {
      clearTimers();
      void performLogout();
    };

    const updateCountdown = () => {
      const remainingMs = IDLE_TIMEOUT_MS - (Date.now() - lastActivityAtRef.current);
      setSecondsRemaining(Math.max(0, Math.ceil(remainingMs / 1000)));
      if (remainingMs <= 0) requestLogout();
    };

    const reevaluate = () => {
      clearTimers();
      if (logoutRequestedRef.current) return;

      const elapsedMs = Date.now() - lastActivityAtRef.current;
      if (elapsedMs >= IDLE_TIMEOUT_MS) {
        requestLogout();
        return;
      }

      if (elapsedMs >= IDLE_WARNING_MS) {
        updateWarning(true);
        updateCountdown();
        countdownTimer = setInterval(updateCountdown, 1000);
        return;
      }

      updateWarning(false);
      setSecondsRemaining(Math.ceil((IDLE_TIMEOUT_MS - IDLE_WARNING_MS) / 1000));
      deadlineTimer = setTimeout(reevaluate, IDLE_WARNING_MS - elapsedMs);
    };

    reevaluateRef.current = reevaluate;
    const storedActivityAt = getLastActivityAt();
    const initialActivityAt = storedActivityAt ?? recordActivity();
    lastActivityAtRef.current = initialActivityAt;
    lastPersistedAtRef.current = initialActivityAt;

    const handleActivity = () => {
      if (warningOpenRef.current || logoutRequestedRef.current) return;
      const now = Date.now();
      lastActivityAtRef.current = now;
      if (now - lastPersistedAtRef.current >= ACTIVITY_WRITE_THROTTLE_MS) {
        recordActivity(now);
        lastPersistedAtRef.current = now;
      }
      reevaluate();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LOGOUT_STORAGE_KEY && event.newValue) {
        logoutRequestedRef.current = true;
        clearTimers();
        clearAuthSession();
        window.location.assign("/login");
        return;
      }

      if (event.key === LAST_ACTIVITY_STORAGE_KEY) {
        const activityAt = parseActivityTimestamp(event.newValue);
        if (activityAt !== null && activityAt > lastActivityAtRef.current) {
          lastActivityAtRef.current = activityAt;
          lastPersistedAtRef.current = activityAt;
          reevaluate();
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") reevaluate();
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "touchstart",
      "scroll",
    ];
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, handleActivity, { passive: true }),
    );
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", reevaluate);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    reevaluate();

    return () => {
      clearTimers();
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, handleActivity));
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", reevaluate);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      reevaluateRef.current = () => undefined;
    };
  }, []);

  return {
    warningOpen,
    secondsRemaining,
    isLoggingOut,
    continueSession,
    signOutNow: performLogout,
  };
}
