const KEY_PREFIX = "clientflow:public-form:idempotency:";

function storageKey(token: string): string {
  return `${KEY_PREFIX}${token}`;
}

export function getPublicFormIdempotencyKey(token: string): string {
  const generated = globalThis.crypto.randomUUID();
  if (typeof globalThis.sessionStorage === "undefined") return generated;

  const key = storageKey(token);
  const existing = globalThis.sessionStorage.getItem(key);
  if (existing) return existing;

  globalThis.sessionStorage.setItem(key, generated);
  return generated;
}

export function clearPublicFormIdempotencyKey(token: string, submittedKey: string): void {
  if (typeof globalThis.sessionStorage === "undefined") return;

  const key = storageKey(token);
  if (globalThis.sessionStorage.getItem(key) === submittedKey) {
    globalThis.sessionStorage.removeItem(key);
  }
}
