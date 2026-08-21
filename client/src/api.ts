/**
 * A failed request, carrying the status beside the server's own sentence. A
 * caller that only wants to show the message keeps reading `.message` as before;
 * one that has to tell a refusal from a clash — a stale calendar save answering
 * 409 — can ask rather than matching on the wording of a sentence.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The server response, for callers whose recovery depends on its code. */
    readonly payload: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const hasJsonBody = init?.body && !(init.body instanceof FormData);
  const response = await fetch(path, {
    ...init,
    headers: { ...(hasJsonBody ? { "Content-Type": "application/json" } : {}), ...init?.headers }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed." }));
    throw new ApiError(
      typeof payload?.error === "string" ? payload.error : "Request failed.",
      response.status,
      payload
    );
  }
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? response.json() : response.text()) as Promise<T>;
}
