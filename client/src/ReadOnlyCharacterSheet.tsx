import { UserRound } from "lucide-react";
import type { CharacterSheetDefinition, CharacterVice, SystemId } from "@devils-toys/shared";
import { entryName, readEntries, singularLabel } from "./character-entries";
import "./ReadOnlyCharacterSheet.css";

export interface ReadOnlyCharacter {
  id: number;
  ownerAccountId: number | null;
  ownerUsername: string | null;
  name: string;
  sheet: Record<string, unknown>;
  portraitUrl: string | null;
  warnings: string[];
  activeBy: { accountId: number; username: string; displayName: string }[];
}

function fixedValue(value: unknown) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  const text = String(value ?? "").trim();
  return text || "—";
}

function pairedStatRows(section: CharacterSheetDefinition["sections"][number]) {
  return section.fields.flatMap((currentField) => {
    if (!currentField.key.endsWith("Current")) return [];
    const statKey = currentField.key.slice(0, -"Current".length);
    const maximumField = section.fields.find((field) => field.key === `${statKey}Max`);
    return maximumField ? [{ label: currentField.label.replace(/\s+current$/i, ""), currentField, maximumField }] : [];
  });
}

function wideSection(section: CharacterSheetDefinition["sections"][number]) {
  return section.fields.some(
    (field) => field.kind === "textarea" || field.kind === "entries" || field.kind === "vices"
  );
}

export function ReadOnlyCharacterSheet({
  character,
  definition,
  system
}: {
  character: ReadOnlyCharacter;
  definition: CharacterSheetDefinition;
  system: SystemId;
}) {
  function renderSection(section: CharacterSheetDefinition["sections"][number]) {
    return (
      <section className={`party-sheet-section${wideSection(section) ? " wide" : ""}`} key={section.id}>
        <h4>{section.label}</h4>
        {section.layout === "paired-current-max" ? (
          <dl className="party-sheet-stats">
            {pairedStatRows(section).map(({ label, currentField, maximumField }) => (
              <div key={currentField.key}>
                <dt>{label}</dt>
                <dd>
                  <span>{fixedValue(character.sheet[currentField.key])}</span>
                  <span aria-hidden="true">/</span>
                  <span>{fixedValue(character.sheet[maximumField.key])}</span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <dl className="party-sheet-fields">
            {section.fields.map((field) => {
              if (field.kind === "entries") {
                const entries = readEntries(character.sheet[field.key]);
                const singular = singularLabel(field.label);
                return (
                  <div className="wide party-sheet-entry-field" key={field.key}>
                    {field.label !== section.label && <dt>{field.label}</dt>}
                    <dd>
                      {entries.length ? (
                        <div className="party-sheet-entries">
                          {entries.map((entry, index) => (
                            <article key={index}>
                              <strong>{entryName(entry, index, singular)}</strong>
                              {entry.text.trim() && <p>{entry.text}</p>}
                            </article>
                          ))}
                        </div>
                      ) : (
                        <span className="party-sheet-empty">None recorded.</span>
                      )}
                    </dd>
                  </div>
                );
              }
              if (field.kind === "vices") {
                const vices = Array.isArray(character.sheet[field.key])
                  ? (character.sheet[field.key] as CharacterVice[]).filter((vice) => vice?.name)
                  : [];
                return (
                  <div className="wide party-sheet-entry-field" key={field.key}>
                    <dd>
                      {vices.length ? (
                        vices.map((vice, index) => (
                          <article className="party-sheet-vice" key={index}>
                            <strong>{vice.name}</strong>
                            <p>
                              <b>Triggers:</b> {vice.triggers || "—"}
                            </p>
                            <p>
                              <b>Satisfying:</b> {vice.satisfying || "—"}
                            </p>
                          </article>
                        ))
                      ) : (
                        <span className="party-sheet-empty">None recorded.</span>
                      )}
                    </dd>
                  </div>
                );
              }
              return (
                <div className={field.kind === "textarea" ? "wide" : ""} key={field.key}>
                  <dt>{field.label}</dt>
                  <dd className={field.kind === "textarea" ? "multiline" : ""}>
                    {fixedValue(character.sheet[field.key])}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </section>
    );
  }

  function renderList(list: CharacterSheetDefinition["lists"][number]) {
    const stored = Array.isArray(character.sheet[list.key]) ? (character.sheet[list.key] as unknown[]) : [];
    const values = list.slots.map((slot, index) => ({ slot, value: fixedValue(stored[index]) }));
    const visible = list.editInDialog ? values.filter((item) => item.value !== "—") : values;
    return (
      <section className="party-sheet-section party-sheet-list" key={list.key}>
        <h4>{list.label}</h4>
        {visible.length ? (
          <dl>
            {visible.map((item) => (
              <div key={item.slot}>
                <dt>{item.slot}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="party-sheet-empty">None recorded.</p>
        )}
      </section>
    );
  }

  const activeNames = character.activeBy.map((member) => member.displayName).join(", ");

  return (
    <div className="party-character-sheet">
      <header className="party-character-profile">
        <div className={`party-character-portrait${character.portraitUrl ? " has-portrait" : ""}`}>
          {character.portraitUrl ? (
            <img src={character.portraitUrl} alt={`${character.name} portrait`} />
          ) : (
            <UserRound aria-hidden="true" />
          )}
        </div>
        <div>
          <span>Character record</span>
          <h3>{character.name}</h3>
          <p>
            {activeNames
              ? `Active: ${activeNames}`
              : character.ownerUsername
                ? `Owned by ${character.ownerUsername}`
                : "Unassigned character"}
          </p>
        </div>
      </header>

      {character.warnings.length > 0 && (
        <section className="party-character-warnings" aria-label="Rules warnings">
          <strong>Check the sheet</strong>
          {character.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </section>
      )}

      <div className={`party-sheet-grid party-sheet-${system}`}>
        {definition.sections.map(renderSection)}
        {definition.lists.map(renderList)}
      </div>
    </div>
  );
}
