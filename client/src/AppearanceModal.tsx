import { Check } from "lucide-react";
import { THEME_IDS, type ThemeId } from "@devils-toys/shared";
import { Modal } from "./Modal";

/**
 * A player's own view of one room. Everything here stays in this browser, so a
 * choice made here changes nothing for the GM or anyone else at the table, and
 * every room is chosen for separately.
 */
export function AppearanceModal({
  roomName,
  roomTheme,
  themeNames,
  personalTheme,
  onChoose,
  onClose
}: {
  roomName: string;
  roomTheme: ThemeId;
  themeNames: Record<ThemeId, string>;
  personalTheme: ThemeId | undefined;
  onChoose: (theme: ThemeId | undefined) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Your view" onClose={onClose}>
      <div className="appearance-settings">
        <p className="modal-intro">
          Pick the theme you want to play in. This changes how <strong>{roomName}</strong> looks for you alone — the
          GM’s theme stays the room’s theme for everyone else, and your other rooms keep their own look.
        </p>
        <button
          type="button"
          className={`appearance-choice ${personalTheme ? "" : "selected"}`}
          onClick={() => onChoose(undefined)}
        >
          <span className={`appearance-swatch theme-${roomTheme}`} aria-hidden="true" />
          <span>
            Match the room
            <small>{themeNames[roomTheme]}, chosen by the GM</small>
          </span>
          {!personalTheme && <Check size={16} />}
        </button>
        <p className="nav-label appearance-label">Or choose your own</p>
        {THEME_IDS.map((theme) => (
          <button
            type="button"
            key={theme}
            className={`appearance-choice ${personalTheme === theme ? "selected" : ""}`}
            onClick={() => onChoose(theme)}
          >
            <span className={`appearance-swatch theme-${theme}`} aria-hidden="true" />
            <span>{themeNames[theme]}</span>
            {personalTheme === theme && <Check size={16} />}
          </button>
        ))}
      </div>
    </Modal>
  );
}
