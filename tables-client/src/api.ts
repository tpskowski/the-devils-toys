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

/**
 * Downloads a file the server generates — a CSV template, a bundle — without
 * navigating away from the editor.
 */
export async function download(path: string, fallbackName: string) {
  const response = await fetch(path);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Download failed." }));
    throw new Error(payload.error ?? "Download failed.");
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const named = /filename="?([^";]+)"?/i.exec(disposition);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = named?.[1] ?? fallbackName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
