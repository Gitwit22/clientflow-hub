import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, cfListAllTerms } from "./apiClient";

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

    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ "X-App-Partition": "clientflow" }),
    }));
  });
});
