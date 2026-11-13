// Shared helpers for the /api functions (Web-standard Request/Response handlers).
// Shared server code lives outside api/ so Vercel only turns the three
// endpoint files in api/ into functions.

export const EXTERNAL_TIMEOUT_MS = 10_000;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  // Never echo internals (or request contents) back to the client.
  console.error("[api] unexpected error:", err instanceof Error ? err.message : String(err));
  return json({ error: "Internal server error" }, 500);
}

/**
 * Same-origin only. We never send Access-Control-Allow-Origin, so browsers block
 * cross-origin reads; on top of that, reject requests whose Origin header names
 * a different host (cross-site form/fetch posts). Requests without an Origin
 * (curl, Invoke-RestMethod, same-origin GETs) are allowed.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Cross-origin requests are not allowed");
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  if (originHost !== host) throw new HttpError(403, "Cross-origin requests are not allowed");
}

export function assertMethod(request: Request, method: "GET" | "POST"): void {
  if (request.method === "OPTIONS") throw new HttpError(403, "Cross-origin requests are not allowed");
  if (request.method !== method) throw new HttpError(405, `Method not allowed, use ${method}`);
}

export async function readJsonBody(request: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, `Request body too large (max ${maxBytes} bytes)`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** fetch with a hard timeout (default 10 s) on every external call. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = EXTERNAL_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs} ms: ${new URL(url).host}`);
    }
    throw err;
  }
}

/** Race any promise against a timeout (for libraries that fetch internally). */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms: ${what}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
