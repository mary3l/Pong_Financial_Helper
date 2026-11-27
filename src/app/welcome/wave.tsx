/**
 * A soft wave along the bottom of a section, drawn in the next section's
 * colour (pass it as a text colour, e.g. "text-mint"), so colours flow into
 * each other instead of meeting at a hard line. It overlaps the next section
 * by 2px so no sliver of colour shows between them. Its parent must be `relative`.
 */
export function Wave({ className, flip = false }: { className: string; flip?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1440 80"
      preserveAspectRatio="none"
      className={`pointer-events-none absolute inset-x-0 -bottom-0.5 block h-10 w-full md:h-16 ${flip ? "-scale-x-100" : ""} ${className}`}
    >
      <path fill="currentColor" d="M0 48C180 12 360 8 540 30s360 50 540 40 270-42 360-52v94H0Z" />
    </svg>
  );
}
