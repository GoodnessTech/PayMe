import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse, HttpError, isTimeoutError } from "./http.js";

describe("errorResponse", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes HttpError status and message through", async () => {
    const res = errorResponse(new HttpError(400, "bad input"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad input" });
  });

  it("turns upstream timeouts (including mid-body aborts) into a 504 with a retry hint", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bodyAbort = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    for (const err of [bodyAbort, new Error("Timed out after 10000 ms: 1click.chaindefuser.com")]) {
      expect(isTimeoutError(err)).toBe(true);
      const res = errorResponse(err);
      expect(res.status).toBe(504);
      expect(((await res.json()) as { error: string }).error).toMatch(/did not respond within 10 s/);
    }
  });

  it("hides unexpected internals behind a generic 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorResponse(new Error("secret internal detail"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});
