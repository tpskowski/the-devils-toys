import { useEffect, useState } from "react";
import type { MediaAsset } from "@devils-toys/shared";
import { api } from "./api";
import { RulesMarkdown } from "./RulesMarkdown";

export function isMarkdownAsset(asset: MediaAsset) {
  return asset.mimeType === "text/markdown" || asset.filename.toLowerCase().endsWith(".md");
}

export function MediaContent({ asset }: { asset: MediaAsset }) {
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

  if (!markdown) return <img src={asset.url} alt={asset.filename} />;
  if (error) return <p className="media-content-status">{error}</p>;
  if (!content) return <p className="media-content-status">Loading Reference…</p>;

  return (
    <div className="markdown media-markdown">
      <RulesMarkdown markdown={content} idPrefix={`media-reference-${asset.id}`} />
    </div>
  );
}
