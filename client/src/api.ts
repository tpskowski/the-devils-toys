export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const hasJsonBody = init?.body && !(init.body instanceof FormData);
  const response = await fetch(path, {
    ...init,
    headers: { ...(hasJsonBody ? { "Content-Type": "application/json" } : {}), ...init?.headers }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed." }));
    throw new Error(payload.error ?? "Request failed.");
  }
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? response.json() : response.text()) as Promise<T>;
}
