import { useEffect, useRef, useState } from "react";
import {
  contrastingDiceInk,
  diceAppearance,
  DICE_THEMES,
  THEME_IDS,
  type DicePreferences,
  type ThemeId
} from "@devils-toys/shared";
import { api } from "./api";
import type { DiceRenderer } from "./dice-renderer";
import "./dice-3d.css";

export function DicePreferencesPanel({
  preferences,
  onChanged,
  theme,
  roomEnabled
}: {
  preferences: DicePreferences;
  onChanged: (value: DicePreferences) => void;
  theme: ThemeId;
  roomEnabled: boolean;
}) {
  const [draft, setDraft] = useState(preferences),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [preview, setPreview] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const appearance = diceAppearance(draft, theme);
  useEffect(() => {
    if (!host.current) return;
    let stopped = false,
      renderer: DiceRenderer | undefined;
    const element = host.current;
    void import("./dice-renderer")
      .then(({ DiceRenderer }) => {
        if (stopped) return;
        try {
          renderer = new DiceRenderer(element);
          renderer.play(
            {
              version: 1,
              id: "preview",
              roomId: 0,
              accountId: 0,
              createdAt: Date.now(),
              seed: 17,
              label: "Preview",
              total: 20,
              modifier: 0,
              appearance,
              dice: [{ definition: "d20", shape: 20, face: 19, value: 20, kept: true, group: 0 }]
            },
            () => {},
            window.matchMedia("(prefers-reduced-motion: reduce)").matches,
            true
          );
        } catch {
          /* The color swatch remains usable without WebGL. */
        }
      })
      .catch(() => {});
    return () => {
      stopped = true;
      renderer?.dispose();
    };
  }, [appearance.body, appearance.ink, appearance.accent, appearance.finish, preview]);
  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await api<{ preferences: DicePreferences }>("/api/me/dice", {
        method: "PUT",
        body: JSON.stringify(draft)
      });
      onChanged(response.preferences);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="dice-preferences">
      <label className="dice-enable">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />
        Show 3D dice on my screen
      </label>
      {!roomEnabled && (
        <p className="system-dice-note">
          The GM must enable 3D dice in room settings. Your choices will be remembered.
        </p>
      )}
      <div className="dice-customizer">
        <div className="dice-preview-wrap" style={{ background: appearance.body, color: appearance.ink }}>
          <span className="dice-preview-swatch" aria-hidden="true">
            20
          </span>
          <div className="dice-preview" ref={host} />
          <button type="button" onClick={() => setPreview(preview + 1)}>
            Preview roll
          </button>
        </div>
        <div className="dice-color-fields">
          <label>
            Dice set
            <select
              value={draft.theme}
              onChange={(e) => setDraft({ ...draft, theme: e.target.value as DicePreferences["theme"] })}
            >
              <option value="room">Use room dice theme</option>
              {THEME_IDS.map((id) => (
                <option key={id} value={id}>
                  {DICE_THEMES[id].name}
                </option>
              ))}
              <option value="custom">Custom colors</option>
            </select>
          </label>
          <div className="dice-color-row">
            {(["body", "ink", "accent"] as const).map((key) => (
              <label key={key}>
                {key === "ink" ? "Numbers" : key === "body" ? "Body" : "Accent"}
                <input
                  type="color"
                  value={appearance[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, theme: "custom", custom: { ...appearance, [key]: e.target.value } })
                  }
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setDraft({
                ...draft,
                theme: "custom",
                custom: { ...appearance, ink: contrastingDiceInk(appearance.body) }
              })
            }
          >
            Contrast numbers automatically
          </button>
          <label>
            Finish
            <select
              value={appearance.finish}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  theme: "custom",
                  custom: { ...appearance, finish: e.target.value as typeof appearance.finish }
                })
              }
            >
              <option value="matte">Matte</option>
              <option value="satin">Satin</option>
              <option value="gloss">Gloss</option>
            </select>
          </label>
        </div>
      </div>
      <p className="system-dice-note">
        Saved for your account across rooms and devices. Other viewers see your chosen set.
      </p>
      {error && <p className="form-error">{error}</p>}
      <button type="button" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save dice preferences"}
      </button>
    </div>
  );
}
