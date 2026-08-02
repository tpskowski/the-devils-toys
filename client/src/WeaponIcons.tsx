/**
 * A firearm and a bow, which Lucide does not carry. Both are drawn in its house
 * style — a 24×24 box, no fill, two-pixel round strokes in the current colour —
 * and take the same `size` prop, so either drops in beside `Swords` without the
 * mark having to know which of the three it is holding.
 */

import type { SVGProps } from "react";

const shared = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
} as const;

/** Sized and labelled like a Lucide icon, so callers can swap one for the other. */
type IconProps = Omit<SVGProps<SVGSVGElement>, "width" | "height"> & { size?: number };

export function GunIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} {...shared} aria-hidden="true" {...props}>
      {/* Slide and barrel, the grip below it, and the trigger guard between. */}
      <path d="M3 7h17v4H3z" />
      <path d="M7 11l-2 7h4l2-7" />
      <path d="M11 11v1.5a1.5 1.5 0 0 0 1.5 1.5H14" />
    </svg>
  );
}

export function BowIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} {...shared} aria-hidden="true" {...props}>
      {/* The limb, the string drawn back to the nock, and the arrow on it. */}
      <path d="M9 3a12 12 0 0 1 0 18" />
      <path d="M9 3 4 12l5 9" />
      <path d="M4 12h16" />
      <path d="m17 9 3 3-3 3" />
    </svg>
  );
}
