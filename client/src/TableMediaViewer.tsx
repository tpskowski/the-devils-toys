import { useEffect, useState, type ReactNode } from "react";
import { Clapperboard, FileText, ImagePlus, Map as MapIcon, Settings2, UsersRound } from "lucide-react";
import type { MediaAsset } from "@devils-toys/shared";
import type { RoomMediaState } from "./MediaModal";
import { isMarkdownAsset, MediaContent } from "./MediaContent";
import { mediaLabel } from "./media-label";
import { SceneViewer, type ScenePing } from "./SceneViewer";

type MediaTab = "map" | "scene" | "reference" | "group";

export function TableMediaViewer({
  media,
  isGm,
  pings,
  groupPage,
  onManage,
  onPing
}: {
  media: RoomMediaState;
  isGm: boolean;
  pings: ScenePing[];
  groupPage?: ReactNode;
  onManage: () => void;
  onPing: (x: number, y: number) => void;
}) {
  const [tab, setTab] = useState<MediaTab>("scene");
  const [mapId, setMapId] = useState<number>();
  const [sceneId, setSceneId] = useState<number>();
  const [referenceId, setReferenceId] = useState<number>();

  const library = media.library ?? [];
  const maps = library.filter((item) => item.kind === "map");
  const scenes = library.filter((item) => item.kind === "scene");
  const selectedMap =
    maps.find((item) => item.id === mapId) ?? maps.find((item) => item.id === media.map?.id) ?? maps[0];
  const selectedScene =
    scenes.find((item) => item.id === sceneId) ?? scenes.find((item) => item.id === media.scene?.id) ?? scenes[0];
  const selectedReference = media.references.find((item) => item.id === referenceId) ?? media.references[0];

  useEffect(() => {
    setMapId(selectedMap?.id);
    setSceneId(selectedScene?.id);
    setReferenceId(selectedReference?.id);
  }, [selectedMap?.id, selectedScene?.id, selectedReference?.id]);

  useEffect(() => {
    if (!groupPage && tab === "group") setTab("scene");
  }, [Boolean(groupPage), tab]);

  const tabItems = tab === "map" ? maps : tab === "scene" ? scenes : tab === "reference" ? media.references : [];
  const selectedId =
    tab === "map"
      ? selectedMap?.id
      : tab === "scene"
        ? selectedScene?.id
        : tab === "reference"
          ? selectedReference?.id
          : undefined;
  const tabLabel = tab === "map" ? "Map" : tab === "scene" ? "Scene" : "Reference";

  function chooseAsset(value: string) {
    const id = Number(value);
    if (tab === "map") setMapId(id);
    if (tab === "scene") setSceneId(id);
    if (tab === "reference") setReferenceId(id);
  }

  const mediaPicker = (
    <label className="table-media-picker">
      <select
        aria-label={`Choose ${tabLabel}`}
        value={selectedId ?? ""}
        onChange={(event) => chooseAsset(event.target.value)}
        disabled={!tabItems.length}
      >
        {!tabItems.length && <option value="">No {tabLabel}s available</option>}
        {tabItems.map((item) => (
          <option key={item.id} value={item.id}>
            {mediaLabel(item)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="table-media-viewer">
      <nav className="table-media-tabs" aria-label="Table media">
        <button className={tab === "map" ? "active" : ""} onClick={() => setTab("map")}>
          <MapIcon /> Maps
        </button>
        {tab === "map" && mediaPicker}
        <button className={tab === "scene" ? "active" : ""} onClick={() => setTab("scene")}>
          <Clapperboard /> Scenes
        </button>
        {tab === "scene" && mediaPicker}
        <button className={tab === "reference" ? "active" : ""} onClick={() => setTab("reference")}>
          References
          {media.references.length > 0 && <span>{media.references.length}</span>}
        </button>
        {tab === "reference" && mediaPicker}
        {groupPage && (
          <button className={tab === "group" ? "active" : ""} onClick={() => setTab("group")}>
            <UsersRound /> Group
          </button>
        )}
        {isGm && (
          <button className="table-media-manage" onClick={onManage} title="Manage Library" aria-label="Manage Library">
            <Settings2 />
          </button>
        )}
      </nav>

      <div className="table-media-panel">
        {tab === "map" && (
          <SceneViewer
            scene={selectedMap ?? null}
            label="Map"
            isGm={isGm}
            pings={pings}
            onManage={onManage}
            onPing={onPing}
          />
        )}
        {tab === "scene" && (
          <SceneViewer
            scene={selectedScene ?? null}
            label="Scene"
            isGm={isGm}
            pings={pings}
            onManage={onManage}
            onPing={onPing}
          />
        )}
        <div className="table-group-panel" hidden={tab !== "group"}>
          {groupPage}
        </div>
        {tab === "reference" && (
          <div className="table-references">
            {selectedReference ? (
              <>
                <div className="table-reference-view">
                  <MediaContent asset={selectedReference} />
                  <p>{mediaLabel(selectedReference)}</p>
                </div>
                <nav className="table-reference-list" aria-label="Available References">
                  {media.references.map((item) => (
                    <button
                      key={item.id}
                      className={item.id === selectedReference.id ? "active" : ""}
                      onClick={() => setReferenceId(item.id)}
                      title={item.filename}
                    >
                      {isMarkdownAsset(item) ? <FileText /> : <img src={item.url} alt="" />}
                      <span>{mediaLabel(item)}</span>
                    </button>
                  ))}
                </nav>
              </>
            ) : (
              <div className="scene-empty table-reference-empty">
                <div className="scene-copy">
                  <p className="eyebrow">References</p>
                  <h2>No References yet.</h2>
                  <p>
                    {isGm ? "Add an image or Markdown file to the Library." : "The GM has not revealed a Reference."}
                  </p>
                  {isGm && (
                    <button className="scene-manage" onClick={onManage}>
                      <ImagePlus /> Open Library
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
