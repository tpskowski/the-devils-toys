import { useEffect, useState } from "react";
import type { MediaAsset } from "@devils-toys/shared";
import { api } from "./api";
import { RulesMarkdown } from "./RulesMarkdown";
import { SceneViewer } from "./SceneViewer";
import { AssetVisibilityControl } from "./AssetVisibilityControl";

export function isMarkdownAsset(asset: MediaAsset) {
  return asset.mimeType === "text/markdown" || asset.filename.toLowerCase().endsWith(".md");
}

export function MediaContent({
  asset,
  isGm = false,
  onMediaChanged
}: {
  asset: MediaAsset;
  isGm?: boolean;
  onMediaChanged?: () => Promise<void>;
}) {
  const markdown = isMarkdownAsset(asset);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setContent("");
    setError("");
    if (!markdown) return;
    api<string>(asset.url)
      .then(setContent)
      .catch((cause) => setError((cause as Error).message));
  }, [asset.id, asset.url, markdown]);

  if (!markdown)
    return (
      <SceneViewer
        key={asset.url}
        scene={asset}
        roomId={asset.roomId}
        label="Reference"
        isGm={isGm}
        onMediaChanged={onMediaChanged}
        pings={[]}
        onManage={() => {}}
      />
    );
  return (
    <div className="markdown media-markdown">
      {isGm && onMediaChanged && (
        <div className="scene-toolbar reference-visibility-toolbar">
          <AssetVisibilityControl key={asset.id} asset={asset} onChanged={onMediaChanged} />
        </div>
      )}
      {error ? (
        <p className="media-content-status">{error}</p>
      ) : !content ? (
        <p className="media-content-status">Loading Reference…</p>
      ) : (
        <RulesMarkdown markdown={content} idPrefix={`media-reference-${asset.id}`} />
      )}
    </div>
  );
}
