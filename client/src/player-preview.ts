export function previewSelection() {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const roomId = Number(params.get("previewRoom"));
  const player = params.get("previewPlayer");
  return roomId > 0 && Number.isSafeInteger(roomId) && player && /^(generic|[1-9]\d*)$/.test(player)
    ? { roomId, player }
    : undefined;
}

export function previewApiPath(path: string) {
  const preview = previewSelection();
  return preview && path.startsWith("/api/") && !path.startsWith("/api/player-preview/")
    ? `/api/player-preview/${preview.roomId}/${preview.player}${path.slice(4)}`
    : path;
}

export function playerPreviewUrl(roomId: number, player: string) {
  return `/?previewRoom=${roomId}&previewPlayer=${encodeURIComponent(player)}`;
}
