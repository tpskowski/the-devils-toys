import type { MediaAsset } from "@devils-toys/shared";

export function mediaLabel(asset: Pick<MediaAsset, "displayName" | "filename" | "mimeType">) {
  const label = asset.displayName?.trim() || asset.filename;
  return asset.mimeType.startsWith("image/") ? label.replace(/\.(?:png|jpe?g|webp)$/i, "") : label;
}

export const mediaKindLabel = (kind: MediaAsset["kind"]) => kind[0].toUpperCase() + kind.slice(1);

const mediaCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Order the supplied visible-to-this-reader assets without changing the source array. */
export function sortMediaByLabel<T extends Pick<MediaAsset, "id" | "displayName" | "filename" | "mimeType">>(
  assets: readonly T[]
): T[] {
  return [...assets].sort(
    (left, right) => mediaCollator.compare(mediaLabel(left), mediaLabel(right)) || left.id - right.id
  );
}
