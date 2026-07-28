import { useState } from "react";
import { BookOpen, Dices } from "lucide-react";
import type { ChatMessage, SavePosition, SystemId } from "@devils-toys/shared";
import { api } from "./api";
import { Modal } from "./Modal";

type RollMode = "dice" | "save" | "damage";
type DamagePosition = "normal" | "impaired" | "enhanced";
type Selection = "" | "kh1" | "kl1";

export function DiceModal({
  roomId,
  system,
  isGm,
  onRolled,
  onClose,
  onRules
}: {
  roomId: number;
  system: SystemId;
  isGm: boolean;
  onRolled: (message: ChatMessage) => void;
  onClose: () => void;
  onRules: () => void;
}) {
  const [mode, setMode] = useState<RollMode>("dice");
  const [count, setCount] = useState(1);
  const [sides, setSides] = useState(20);
  const [modifier, setModifier] = useState(0);
  const [selection, setSelection] = useState<Selection>("");
  const [ability, setAbility] = useState<"STR" | "DEX" | "WIL">("STR");
  const [target, setTarget] = useState(10);
  const [savePosition, setSavePosition] = useState<SavePosition>("normal");
  const [damagePosition, setDamagePosition] = useState<DamagePosition>("normal");
  // One choice with three states, offered as the two checkboxes a GM ticks.
  const [visibility, setVisibility] = useState<"public" | "private" | "invisible">("public");
  const [error, setError] = useState("");

  const rollCount = mode === "save" ? 1 : count;
  const rollSides =
    mode === "save"
      ? 20
      : mode === "damage" && damagePosition !== "normal"
        ? damagePosition === "impaired"
          ? 4
          : 12
        : sides;
  const rollSelection = mode === "damage" && rollCount > 1 ? "kh1" : mode === "dice" && rollCount > 1 ? selection : "";
  const rollModifier = mode === "save" ? 0 : modifier;
  const expression = `${rollCount}d${rollSides}${rollSelection}${rollModifier ? `${rollModifier > 0 ? "+" : ""}${rollModifier}` : ""}`;

  async function roll() {
    setError("");
    try {
      const response = await api<{ message: ChatMessage }>(`/api/rooms/${roomId}/rolls`, {
        method: "POST",
        body: JSON.stringify({
          expression,
          private: visibility !== "public",
          invisible: visibility === "invisible",
          save:
            mode === "save" ? { target, ability, position: system === "monolith" ? savePosition : "normal" } : undefined
        })
      });
      onRolled(response.message);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <Modal title="Roll dice" onClose={onClose}>
      <div className="dice-builder">
        <div className="dice-mode-row" aria-label="Roll type">
          {(["dice", "save", "damage"] as const).map((item) => (
            <button key={item} className={mode === item ? "selected" : ""} onClick={() => setMode(item)}>
              {item === "dice" ? "Free roll" : item === "save" ? "Save" : "Damage"}
            </button>
          ))}
        </div>

        {mode === "save" ? (
          <>
            <div className="dice-field-row">
              <label>
                Ability
                <select value={ability} onChange={(event) => setAbility(event.target.value as typeof ability)}>
                  <option value="STR">STR</option>
                  <option value="DEX">DEX</option>
                  <option value="WIL">WIL</option>
                </select>
              </label>
              <label>
                Target
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={target}
                  onChange={(event) => setTarget(Number(event.target.value))}
                />
              </label>
            </div>
            {system === "monolith" && (
              <>
                <div className="dice-position-row" aria-label="Save position">
                  {(["normal", "advantage", "disadvantage"] as const).map((position) => (
                    <button
                      key={position}
                      className={savePosition === position ? "selected" : ""}
                      onClick={() => setSavePosition(position)}
                    >
                      {position === "normal" ? "Normal" : position === "advantage" ? "ADV" : "DIS"}
                    </button>
                  ))}
                </div>
                <p className="system-dice-note">
                  ADV/DIS changes the outcome quality. It does not add dice or change the d20 result.
                </p>
              </>
            )}
            <p className="system-dice-note">
              Roll d20 equal to or under the ability. 1 always succeeds; 20 always fails.
            </p>
          </>
        ) : (
          <>
            <label>
              Dice
              <input
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
              />
            </label>
            {mode === "damage" && (
              <div className="dice-position-row" aria-label="Attack position">
                {(["normal", "impaired", "enhanced"] as const).map((position) => (
                  <button
                    key={position}
                    className={damagePosition === position ? "selected" : ""}
                    onClick={() => setDamagePosition(position)}
                  >
                    {position}
                  </button>
                ))}
              </div>
            )}
            {(mode === "dice" || damagePosition === "normal") && (
              <div className="die-row">
                {[4, 6, 8, 10, 12, 20, 44, 66, 100].map((die) => (
                  <button key={die} className={sides === die ? "selected" : ""} onClick={() => setSides(die)}>
                    d{die}
                  </button>
                ))}
              </div>
            )}
            {mode === "damage" && damagePosition !== "normal" && (
              <p className="system-dice-note">
                {damagePosition === "impaired" ? "Impaired damage uses d4." : "Enhanced damage uses d12."}
              </p>
            )}
            {mode === "dice" && count > 1 && (
              <label>
                Combine
                <select value={selection} onChange={(event) => setSelection(event.target.value as Selection)}>
                  <option value="">Add all dice</option>
                  <option value="kh1">Keep highest</option>
                  <option value="kl1">Keep lowest</option>
                </select>
              </label>
            )}
            {mode === "damage" && count > 1 && (
              <p className="system-dice-note">
                Multiple attackers, bonus damage, and dual weapons keep the single highest die.
              </p>
            )}
            <label>
              Modifier
              <input
                type="number"
                min={-100}
                max={100}
                value={modifier}
                onChange={(event) => setModifier(Number(event.target.value))}
              />
            </label>
          </>
        )}

        <div className="dice-visibility-row">
          <label className="check-row">
            <input
              type="checkbox"
              checked={visibility === "private"}
              onChange={() => setVisibility((current) => (current === "private" ? "public" : "private"))}
            />
            Private
          </label>
          {isGm && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={visibility === "invisible"}
                onChange={() => setVisibility((current) => (current === "invisible" ? "public" : "invisible"))}
              />
              Invisible
            </label>
          )}
        </div>
        {visibility !== "public" && (
          <p className="system-dice-note">
            {visibility === "private"
              ? isGm
                ? "Only you see the result. The table is told a roll was made."
                : "Only you and the GM see the result. The table is told a roll was made."
              : "Only you see the result. The table is told nothing."}
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        <button className="rules-link" type="button" onClick={onRules}>
          <BookOpen /> Read rolling rules
        </button>
        <button className="primary-button" onClick={roll}>
          <Dices /> Roll {expression}
        </button>
      </div>
    </Modal>
  );
}
