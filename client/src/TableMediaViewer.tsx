import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  Clapperboard,
  FileText,
  ImagePlus,
  BookOpen,
  Map as MapIcon,
  Settings2,
  UsersRound
} from "lucide-react";
import type { MapNotationEvent, MediaAsset } from "@devils-toys/shared";
import type { RoomMediaState } from "./MediaModal";
import { isMarkdownAsset, MediaContent } from "./MediaContent";
import { mediaLabel } from "./media-label";
import { SceneViewer, type ScenePing } from "./SceneViewer";

type MediaTab = "map" | "scene" | "reference" | "group" | "rules";

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPosition, setPickerPosition] = useState<CSSProperties>({});
  const pickerToggle = useRef<HTMLButtonElement>(null);
  const pickerMenu = useRef<HTMLDivElement>(null);

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

  useEffect(() => setPickerOpen(false), [tab]);

  useEffect(() => {
    if (requestedTab) setTab(requestedTab.tab);
  }, [requestedTab?.revision]);

  useEffect(() => {
    if (!pickerOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!pickerToggle.current?.contains(target) && !pickerMenu.current?.contains(target)) setPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPickerOpen(false);
        pickerToggle.current?.focus();
      }
    };
    const closeOnViewportChange = () => setPickerOpen(false);
    const closeOnScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && pickerMenu.current?.contains(target)) return;
      setPickerOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    addEventListener("resize", closeOnViewportChange);
    addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      removeEventListener("resize", closeOnViewportChange);
      removeEventListener("scroll", closeOnScroll, true);
    };
  }, [pickerOpen]);

  const pickerOptions =
    tab === "map"
      ? maps.map((item) => ({ id: String(item.id), label: mediaLabel(item) }))
      : tab === "scene"
        ? scenes.map((item) => ({ id: String(item.id), label: mediaLabel(item) }))
        : tab === "reference"
          ? media.references.map((item) => ({ id: String(item.id), label: mediaLabel(item) }))
          : tab === "group"
            ? (groupPicker?.options ?? [])
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
            : "Rules";

  function choosePicker(value: string) {
    if (tab === "group") groupPicker?.onSelect(value);
    const id = Number(value);
    if (tab === "map") setMapId(id);
    if (tab === "scene") setSceneId(id);
    if (tab === "reference") setReferenceId(id);
    setPickerOpen(false);
  }

  function togglePicker(event: MouseEvent<HTMLButtonElement>) {
    if (!pickerOptions.length) return;
    const tabBounds = event.currentTarget.closest(".table-media-tab")?.getBoundingClientRect();
    if (!tabBounds) return;
    const width = Math.min(240, window.innerWidth - 16);
    setPickerPosition({
      top: tabBounds.bottom + 4,
      left: Math.min(Math.max(8, tabBounds.left), window.innerWidth - width - 8),
      width
    });
    setPickerOpen((current) => !current);
  }

  function activateTab(nextTab: MediaTab, event: MouseEvent<HTMLButtonElement>) {
    if (tab === nextTab) {
      togglePicker(event);
      return;
    }
    setTab(nextTab);
  }

  const assetPicker =
    pickerOpen &&
    pickerOptions.length > 0 &&
    createPortal(
      <div
        ref={pickerMenu}
        className="table-media-picker-menu"
        style={pickerPosition}
        role="listbox"
        aria-label={`Choose ${tabLabel}`}
      >
        {pickerOptions.map((item) => (
          <button
            key={item.id}
            className={item.id === selectedPickerId ? "selected" : ""}
            role="option"
            aria-selected={item.id === selectedPickerId}
            onClick={() => choosePicker(item.id)}
          >
            <span>{item.label}</span>
            {item.id === selectedPickerId && <Check />}
          </button>
        ))}
      </div>,
      document.querySelector(".workspace") ?? document.body
    );

  return (
    <div className="table-media-viewer">
      <nav className="table-media-tabs" aria-label="Table media">
        <div className={`table-media-tab${tab === "map" ? " active" : ""}`}>
          <button
            ref={tab === "map" ? pickerToggle : undefined}
            className={`table-media-tab-main${tab === "map" && pickerOpen ? " picker-open" : ""}`}
            onClick={(event) => activateTab("map", event)}
            aria-haspopup={tab === "map" ? "listbox" : undefined}
            aria-expanded={tab === "map" ? pickerOpen : undefined}
          >
            <MapIcon /> Maps
            {tab === "map" && (
              <ChevronDown className={`table-media-picker-chevron${maps.length ? "" : " picker-empty"}`} />
            )}
          </button>
        </div>
        <div className={`table-media-tab${tab === "scene" ? " active" : ""}`}>
          <button
            ref={tab === "scene" ? pickerToggle : undefined}
            className={`table-media-tab-main${tab === "scene" && pickerOpen ? " picker-open" : ""}`}
            onClick={(event) => activateTab("scene", event)}
            aria-haspopup={tab === "scene" ? "listbox" : undefined}
            aria-expanded={tab === "scene" ? pickerOpen : undefined}
          >
            <Clapperboard /> Scenes
            {tab === "scene" && (
              <ChevronDown className={`table-media-picker-chevron${scenes.length ? "" : " picker-empty"}`} />
            )}
          </button>
        </div>
        <div className={`table-media-tab${tab === "reference" ? " active" : ""}`}>
          <button
            ref={tab === "reference" ? pickerToggle : undefined}
            className={`table-media-tab-main${tab === "reference" && pickerOpen ? " picker-open" : ""}`}
            onClick={(event) => activateTab("reference", event)}
            aria-haspopup={tab === "reference" ? "listbox" : undefined}
            aria-expanded={tab === "reference" ? pickerOpen : undefined}
          >
            References
            {tab === "reference" && (
              <ChevronDown className={`table-media-picker-chevron${media.references.length ? "" : " picker-empty"}`} />
            )}
          </button>
        </div>
        {groupPage && (
          <div className={`table-media-tab${tab === "group" ? " active" : ""}`}>
            <button
              ref={tab === "group" && groupPicker ? pickerToggle : undefined}
              className={`table-media-tab-main${tab === "group" && pickerOpen ? " picker-open" : ""}`}
              onClick={(event) => activateTab("group", event)}
              aria-haspopup={tab === "group" && groupPicker ? "listbox" : undefined}
              aria-expanded={tab === "group" && groupPicker ? pickerOpen : undefined}
            >
              <UsersRound /> Group
              {tab === "group" && groupPicker && (
                <ChevronDown
                  className={`table-media-picker-chevron${groupPicker.options.length ? "" : " picker-empty"}`}
                />
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
      {assetPicker}

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
