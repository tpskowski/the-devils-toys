import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import {
  ChevronDown,
  Clapperboard,
  FileText,
  ImagePlus,
  BookOpen,
  Map as MapIcon,
  Settings2,
  UsersRound,
  Swords
} from "lucide-react";
import type { MapNotationEvent, MediaAsset } from "@devils-toys/shared";
import type { RoomMediaState } from "./MediaModal";
import { isMarkdownAsset, MediaContent } from "./MediaContent";
import { mediaLabel } from "./media-label";
import { SceneViewer, type ScenePing } from "./SceneViewer";
import { useTabPicker } from "./TabPicker";

type MediaTab = "map" | "scene" | "reference" | "group" | "encounter" | "rules";

interface GroupPicker {
  options: readonly { id: string; label: string }[];
  selected: string;
  onSelect: (id: string) => void;
}
export function TableMediaViewer({
  roomId,
  media,
  isGm,
  pings,
  groupPage,
  groupPicker,
  encounterPage,
  encounterPicker,
  encounterEnabled,
  onManage,
  onPing,
  mapNotationEnabled,
  mapNotationSyncRevision,
  mapNotationChange,
  rulesPage,
  requestedTab
}: {
  roomId: number;
  media: RoomMediaState;
  isGm: boolean;
  pings: ScenePing[];
  groupPage?: ReactNode;
  groupPicker?: GroupPicker;
  encounterPage?: ReactNode;
  encounterPicker?: {
    options: readonly { id: string; label: string }[];
    selected: string;
    onSelect: (id: string) => void;
  };
  encounterEnabled: boolean;
  onManage: () => void;
  onPing: (x: number, y: number) => void;
  mapNotationEnabled: boolean;
  mapNotationSyncRevision: number;
  mapNotationChange?: MapNotationEvent;
  rulesPage: ReactNode;
  requestedTab?: { tab: "rules"; revision: number };
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
    if (!encounterEnabled && tab === "encounter") setTab("scene");
  }, [Boolean(groupPage), encounterEnabled, tab]);

  useEffect(() => {
    if (requestedTab) setTab(requestedTab.tab);
  }, [requestedTab?.revision]);

  const pickerOptions =
    tab === "map"
      ? maps.map((item) => ({
          id: String(item.id),
          label: mediaLabel(item),
          hiddenFromPlayers: isGm && !item.visible,
          thumbnailUrl: item.thumbnailUrl ?? item.url
        }))
      : tab === "scene"
        ? scenes.map((item) => ({
            id: String(item.id),
            label: mediaLabel(item),
            hiddenFromPlayers: isGm && !item.visible,
            thumbnailUrl: item.thumbnailUrl ?? item.url
          }))
        : tab === "reference"
          ? media.references.map((item) => ({
              id: String(item.id),
              label: mediaLabel(item),
              hiddenFromPlayers: isGm && !item.visible,
              thumbnailUrl: isMarkdownAsset(item) ? undefined : (item.thumbnailUrl ?? item.url)
            }))
          : tab === "group"
            ? (groupPicker?.options ?? [])
            : tab === "encounter"
              ? (encounterPicker?.options ?? [])
              : [];
  const selectedPickerId =
    tab === "map"
      ? selectedMap && String(selectedMap.id)
      : tab === "scene"
        ? selectedScene && String(selectedScene.id)
        : tab === "reference"
          ? selectedReference && String(selectedReference.id)
          : tab === "group"
            ? groupPicker?.selected
            : tab === "encounter"
              ? encounterPicker?.selected
              : undefined;
  const tabLabel =
    tab === "map"
      ? "Map"
      : tab === "scene"
        ? "Scene"
        : tab === "reference"
          ? "Reference"
          : tab === "group"
            ? "Group view"
            : tab === "encounter"
              ? "Encounter"
              : "Rules";

  const picker = useTabPicker({
    options: pickerOptions,
    selected: selectedPickerId,
    label: tabLabel,
    anchorSelector: ".table-media-tab",
    menuWidth: tab === "map" || tab === "scene" || tab === "reference" ? 280 : undefined,
    onSelect: (value) => {
      if (tab === "group") groupPicker?.onSelect(value);
      if (tab === "encounter") encounterPicker?.onSelect(value);
      const id = Number(value);
      if (tab === "map") setMapId(id);
      if (tab === "scene") setSceneId(id);
      if (tab === "reference") setReferenceId(id);
    }
  });

  // Switching tabs changes what the menu would offer, so it closes rather than
  // repointing at another tab's list.
  useEffect(picker.close, [tab]);

  function activateTab(nextTab: MediaTab, event: MouseEvent<HTMLButtonElement>) {
    if (tab === nextTab) {
      picker.toggle(event);
      return;
    }
    setTab(nextTab);
  }

  return (
    <div className="table-media-viewer">
      <nav className="table-media-tabs" aria-label="Table media">
        <div className={`table-media-tab${tab === "map" ? " active" : ""}`}>
          <button
            ref={tab === "map" ? picker.toggleRef : undefined}
            className={`table-media-tab-main${tab === "map" && picker.open ? " picker-open" : ""}`}
            onClick={(event) => activateTab("map", event)}
            aria-haspopup={tab === "map" ? "listbox" : undefined}
            aria-expanded={tab === "map" ? picker.open : undefined}
          >
            <MapIcon /> Maps
            {tab === "map" && <ChevronDown className={`tab-picker-chevron${maps.length ? "" : " picker-empty"}`} />}
          </button>
        </div>
        <div className={`table-media-tab${tab === "scene" ? " active" : ""}`}>
          <button
            ref={tab === "scene" ? picker.toggleRef : undefined}
            className={`table-media-tab-main${tab === "scene" && picker.open ? " picker-open" : ""}`}
            onClick={(event) => activateTab("scene", event)}
            aria-haspopup={tab === "scene" ? "listbox" : undefined}
            aria-expanded={tab === "scene" ? picker.open : undefined}
          >
            <Clapperboard /> Scenes
            {tab === "scene" && <ChevronDown className={`tab-picker-chevron${scenes.length ? "" : " picker-empty"}`} />}
          </button>
        </div>
        <div className={`table-media-tab${tab === "reference" ? " active" : ""}`}>
          <button
            ref={tab === "reference" ? picker.toggleRef : undefined}
            className={`table-media-tab-main${tab === "reference" && picker.open ? " picker-open" : ""}`}
            onClick={(event) => activateTab("reference", event)}
            aria-haspopup={tab === "reference" ? "listbox" : undefined}
            aria-expanded={tab === "reference" ? picker.open : undefined}
          >
            References
            {tab === "reference" && (
              <ChevronDown className={`tab-picker-chevron${media.references.length ? "" : " picker-empty"}`} />
            )}
          </button>
        </div>
        {groupPage && (
          <div className={`table-media-tab${tab === "group" ? " active" : ""}`}>
            <button
              ref={tab === "group" && groupPicker ? picker.toggleRef : undefined}
              className={`table-media-tab-main${tab === "group" && picker.open ? " picker-open" : ""}`}
              onClick={(event) => activateTab("group", event)}
              aria-haspopup={tab === "group" && groupPicker ? "listbox" : undefined}
              aria-expanded={tab === "group" && groupPicker ? picker.open : undefined}
            >
              <UsersRound /> Group
              {tab === "group" && groupPicker && (
                <ChevronDown className={`tab-picker-chevron${groupPicker.options.length ? "" : " picker-empty"}`} />
              )}
            </button>
          </div>
        )}
        {encounterEnabled && (
          <div className={`table-media-tab${tab === "encounter" ? " active" : ""}`}>
            <button
              ref={tab === "encounter" && encounterPicker ? picker.toggleRef : undefined}
              className={`table-media-tab-main${tab === "encounter" && picker.open ? " picker-open" : ""}`}
              onClick={(event) => activateTab("encounter", event)}
              aria-haspopup={tab === "encounter" && encounterPicker ? "listbox" : undefined}
              aria-expanded={tab === "encounter" && encounterPicker ? picker.open : undefined}
            >
              <Swords /> Encounter
              {tab === "encounter" && encounterPicker && (
                <ChevronDown className={`tab-picker-chevron${encounterPicker.options.length ? "" : " picker-empty"}`} />
              )}
            </button>
          </div>
        )}
        <div className={`table-media-tab${tab === "rules" ? " active" : ""}`}>
          <button className="table-media-tab-main" onClick={(event) => activateTab("rules", event)}>
            <BookOpen /> Rules
          </button>
        </div>
        {isGm && (
          <button className="table-media-manage" onClick={onManage} title="Manage Library" aria-label="Manage Library">
            <Settings2 />
          </button>
        )}
      </nav>
      {picker.menu}

      <div className="table-media-panel">
        {tab === "map" && (
          <SceneViewer
            scene={selectedMap ?? null}
            label="Map"
            isGm={isGm}
            pings={pings}
            onManage={onManage}
            onPing={onPing}
            mapNotation={
              mapNotationEnabled
                ? { roomId, syncRevision: mapNotationSyncRevision, change: mapNotationChange }
                : undefined
            }
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
        <div className="table-encounter-panel" hidden={tab !== "encounter"}>
          {encounterPage}
        </div>
        <div className="table-rules-panel" hidden={tab !== "rules"}>
          {rulesPage}
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
