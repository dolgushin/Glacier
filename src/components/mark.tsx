/**
 * The mark: three stacked strata cut by a diagonal — a glacier in section.
 * Geometric, drawn on the same grid as the layout, and no emoji.
 */
export function Mark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path d="M0 20 L10 4 L20 20 Z" fill="currentColor" />
      <path d="M4.7 12.5 L15.3 12.5" stroke="var(--color-paper)" strokeWidth="1.4" />
      <path d="M7 8.5 L13 8.5" stroke="var(--color-paper)" strokeWidth="1.4" />
    </svg>
  );
}

/** Wordmark used in the header and on the auth screens. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <Mark size={18} className="text-ink" />
      <span className="text-[15px] font-semibold tracking-[0.02em] text-ink">Glacier</span>
    </span>
  );
}
