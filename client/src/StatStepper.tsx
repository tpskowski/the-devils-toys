import { ChevronDown, ChevronUp, X } from "lucide-react";

/**
 * A score and the two buttons that move it by one. Where a floor action is given
 * — Cairn and Monolith spend attributes once hit points run out — the lower
 * button becomes it at zero rather than sitting there disabled.
 */
export function StatStepper({
  label,
  value,
  maximum,
  onStep,
  onFloor,
  floorLabel = "Use floor action"
}: {
  /** What is being moved, as a phrase: "Bea's hit points". */
  label: string;
  value: number;
  maximum?: number;
  onStep: (target: number) => void;
  onFloor?: () => void;
  floorLabel?: string;
}) {
  return (
    <span className="stat-stepper">
      <button
        type="button"
        disabled={maximum !== undefined && value >= maximum}
        title={`Raise ${label}`}
        aria-label={`Raise ${label}`}
        onClick={() => onStep(value + 1)}
      >
        <ChevronUp />
      </button>
      {value <= 0 && onFloor ? (
        <button
          type="button"
          className="stat-stepper-floor"
          title={floorLabel}
          aria-label={floorLabel}
          onClick={onFloor}
        >
          <X />
        </button>
      ) : (
        <button
          type="button"
          disabled={value <= 0}
          title={`Lower ${label}`}
          aria-label={`Lower ${label}`}
          onClick={() => onStep(value - 1)}
        >
          <ChevronDown />
        </button>
      )}
    </span>
  );
}
