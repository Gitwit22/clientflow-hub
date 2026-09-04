export const IDLE_TIMEOUT_MS = 20 * 60 * 1000;
export const IDLE_WARNING_MS = 18 * 60 * 1000;

export const LAST_ACTIVITY_STORAGE_KEY = "clientflow:last-activity-at";
export const LOGOUT_STORAGE_KEY = "clientflow:logout-at";

function storageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function parseActivityTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

export function getLastActivityAt(): number | null {
  if (!storageAvailable()) return null;
  return parseActivityTimestamp(window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY));
}

export function recordActivity(at = Date.now()): number {
  if (storageAvailable()) {
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(at));
  }
  return at;
}

export function clearIdleSession(): void {
  if (storageAvailable()) {
    window.localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
  }
}

export function broadcastLogout(at = Date.now()): void {
  if (storageAvailable()) {
    window.localStorage.setItem(LOGOUT_STORAGE_KEY, String(at));
  }
}

export function isIdleSessionExpired(now = Date.now()): boolean {
  const lastActivityAt = getLastActivityAt();
  return lastActivityAt !== null && now - lastActivityAt >= IDLE_TIMEOUT_MS;
}
