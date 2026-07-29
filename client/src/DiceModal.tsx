import { useState } from "react";
import { BookOpen, Dices } from "lucide-react";
import type { ChatMessage, DiceRules, SavePosition } from "@devils-toys/shared";
import { api } from "./api";
import { Modal } from "./Modal";
import type { SaveRollSetup } from "./save-roll";

type RollMode = "dice" | "save" | "skill" | "damage";
type DamagePosition = "normal" | "impaired" | "enhanced";
type Selection = "" | "kh1" | "kl1";
type RollVisibility = "public" | "private" | "invisible";

export function rollVisibilityNotice(visibility: RollVisibility, isGm: boolean) {
  if (visibility === "private") {
    return isGm
      ? "Only you see the result. The table is told a roll was made."
      : "Only you and the GM see the result. The table is told a roll was made.";
  }
  if (visibility === "invisible") return "Only you see the result. The table is told nothing.";
  return "";
}

export function DiceModal({
  roomId,
  diceRules,
  isGm,
  initialSave,
  onRolled,
  onClose,
  onRules
}: {
  roomId: number;
  diceRules: DiceRules;
  isGm: boolean;
  initialSave?: SaveRollSetup;
  onRolled: (message: ChatMessage) => void;
  onClose: () => void;
  onRules: () => void;
}) {
  const [mode, setMode] = useState<RollMode>(initialSave ? "save" : "dice");
  const [count, setCount] = useState(1);
  const [sides, setSides] = useState(20);
  const [modifier, setModifier] = useState(0);
  const [selection, setSelection] = useState<Selection>("");
  const [saveLabel, setSaveLabel] = useState(initialSave?.label ?? diceRules.save.types[0]?.label ?? "Save");
  const [target, setTarget] = useState(initialSave?.target ?? 10);
  const [difficulty, setDifficulty] = useState(diceRules.skillCheck?.defaultDifficulty ?? 8);
  const [savePosition, setSavePosition] = useState<SavePosition>("normal");
  const [damagePosition, setDamagePosition] = useState<DamagePosition>("normal");
  // Visibility is one mutually exclusive choice; "public" is labeled Standard in the UI.
  const [visibility, setVisibility] = useState<RollVisibility>("public");
  const [error, setError] = useState("");

  const rollCount = mode === "save" ? 1 : mode === "skill" ? 2 : count;
  const rollSides =
    mode === "save"
      ? 20
      : mode === "skill"
        ? 6
        : mode === "damage" && damagePosition !== "normal"
          ? damagePosition === "impaired"
            ? (diceRules.damage?.impairedSides ?? 4)
            : (diceRules.damage?.enhancedSides ?? 12)
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
          save: mode === "save" ? { target, label: saveLabel, position: savePosition } : undefined,
          check: mode === "skill" ? { difficulty, label: diceRules.skillCheck?.label ?? "Skill check" } : undefined
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
          {(
            [
              "dice",
              "save",
              ...(diceRules.skillCheck ? (["skill"] as const) : []),
              ...(diceRules.damage ? (["damage"] as const) : [])
            ] as RollMode[]
          ).map((item) => (
            <button key={item} className={mode === item ? "selected" : ""} onClick={() => setMode(item)}>
              {item === "dice" ? "Free roll" : item === "save" ? "Save" : item === "skill" ? "Skill check" : "Damage"}
            </button>
          ))}
        </div>

        {mode === "save" ? (
          <>
            <div className="dice-field-row">
              <label>
                Save
                <select value={saveLabel} onChange={(event) => setSaveLabel(event.target.value)}>
                  {diceRules.save.types.map((type) => (
                    <option value={type.label} key={type.id}>
                      {type.label}
                    </option>
                  ))}
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
            {(diceRules.save.outcomes.advantage || diceRules.save.outcomes.disadvantage) && (
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
              Roll d20 {diceRules.save.success === "equal-or-under" ? "equal to or under" : "equal to or over"} the
              target. Natural {diceRules.save.automaticSuccess} succeeds; natural {diceRules.save.automaticFailure}{" "}
              fails.
            </p>
          </>
        ) : mode === "skill" ? (
          <>
            <div className="dice-field-row">
              <label>
                Modifier
                <input
                  type="number"
                  min={-20}
                  max={20}
                  value={modifier}
                  onChange={(event) => setModifier(Number(event.target.value))}
                />
              </label>
              <label>
                Difficulty
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={difficulty}
                  onChange={(event) => setDifficulty(Number(event.target.value))}
                />
              </label>
            </div>
            <p className="system-dice-note">Roll 2d6 plus skill and attribute modifiers against the difficulty.</p>
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

        <div className={`dice-visibility-row${isGm ? "" : " player"}`} aria-label="Roll visibility">
          <button
            type="button"
            className={visibility === "public" ? "selected" : ""}
            aria-pressed={visibility === "public"}
            onClick={() => setVisibility("public")}
          >
            Standard
          </button>
          <button
            type="button"
            className={visibility === "private" ? "selected" : ""}
            aria-pressed={visibility === "private"}
            onClick={() => setVisibility("private")}
          >
            Private
          </button>
          {isGm && (
            <button
              type="button"
              className={visibility === "invisible" ? "selected" : ""}
              aria-pressed={visibility === "invisible"}
              onClick={() => setVisibility("invisible")}
            >
              Invisible
            </button>
          )}
        </div>
        {visibility !== "public" && <p className="system-dice-note">{rollVisibilityNotice(visibility, isGm)}</p>}
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
