import type { MediaAsset } from "@devils-toys/shared";

export function mediaLabel(asset: Pick<MediaAsset, "displayName" | "filename" | "mimeType">) {
  const label = asset.displayName?.trim() || asset.filename;
  return asset.mimeType.startsWith("image/") ? label.replace(/\.(?:png|jpe?g|webp)$/i, "") : label;
}

export const mediaKindLabel = (kind: MediaAsset["kind"]) => kind[0].toUpperCase() + kind.slice(1);
