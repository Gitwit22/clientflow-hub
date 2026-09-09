import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiRequest,
  cfListAllTerms,
  isStalePublicFormError,
  submitPublicForm,
} from "./apiClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("paginated ClientFlow lists", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads pages until the API returns a short page", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({ id: `term-${index}` }));
    const secondPage = [{ id: "term-500" }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse(secondPage));
    vi.stubGlobal("fetch", fetchMock);

    const result = await cfListAllTerms();

    expect(result).toHaveLength(501);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toMatch(/terms\?limit=500&offset=0$/);
    expect(fetchMock.mock.calls[1][0]).toMatch(/terms\?limit=500&offset=500$/);
  });

  it("rejects instead of returning a partial collection when a later page fails", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({ id: `term-${index}` }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse({ message: "Database unavailable" }, 503));
    vi.stubGlobal("fetch", fetchMock);

    await expect(cfListAllTerms()).rejects.toEqual(
      expect.objectContaining<ApiError>({ status: 503, message: "Database unavailable" }),
    );
  });
});

describe("ClientFlow partition routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not allow a caller to override the ClientFlow partition", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/v1/auth/session", {
      headers: { "X-App-Partition": "fba-app" },
    });

    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ "X-App-Partition": "clientflow" }),
      }),
    );
  });
});

describe("public form errors", () => {
  it("identifies stale form conflicts as recoverable", () => {
    expect(isStalePublicFormError(new ApiError(409, "CONFLICT", "Reload the form."))).toBe(true);
    expect(isStalePublicFormError(new ApiError(500, "INTERNAL_SERVER_ERROR", "Failed"))).toBe(
      false,
    );
    expect(isStalePublicFormError(new Error("Failed"))).toBe(false);
  });

  it("retries one server failure with the same submission payload", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: "INTERNAL", message: "Failed" } }, 500))
      .mockResolvedValueOnce(jsonResponse({ success: true, enrollmentIds: ["enrollment-1"] }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      coreResponses: {},
      programResponses: {},
      selectedProgramIds: [],
      configurationToken: "configuration-1",
      idempotencyKey: "request-1",
    };

    const submission = submitPublicForm("token-1", payload);
    await vi.advanceTimersByTimeAsync(250);

    await expect(submission).resolves.toEqual({ success: true, enrollmentIds: ["enrollment-1"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(fetchMock.mock.calls[1][1]?.body);
    vi.useRealTimers();
  });

  it("does not retry validation failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { code: "BAD_REQUEST", message: "Please complete the form." } }, 400),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitPublicForm("token-1", {
        coreResponses: {},
        programResponses: {},
        selectedProgramIds: [],
        configurationToken: "configuration-1",
        idempotencyKey: "request-1",
      }),
    ).rejects.toEqual(expect.objectContaining({ status: 400 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
