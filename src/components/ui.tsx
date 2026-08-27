import type { ReactNode } from "react";
import { percent, pnlClass, signedMoney, signedPercent } from "@/lib/format";

/*
 * Hybrid component set: Snowball's card structure, held together by hairlines
 * instead of shadows. A card here is a white panel with a 1px border and an 8px
 * radius — nothing floats, nothing glows.
 */

/** A white panel. The default container for everything on a page. */
export function Section({
  children,
  title,
  subtitle,
  action,
  className = "",
  flush = false,
}: {
  children: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Drop the inner padding, for a card that is entirely a table. */
  flush?: boolean;
}) {
  return (
    // min-w-0: a grid child defaults to min-width:auto and refuses to shrink
    // below its content, which pushes wide tables past the viewport.
    <section className={`card min-w-0 ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule px-5 py-4">
          <div className="min-w-0">
            <h2 className="eyebrow">{title}</h2>
            {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-soft">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0 text-xs">{action}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

/** The one number a page is built around, in its own card. */
export function Hero({
  label,
  value,
  meta,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="card p-6">
      <div className="eyebrow">{label}</div>
      <div className="display mt-3">{value}</div>
      {meta && <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1">{meta}</div>}
    </div>
  );
}

/** A supporting figure. Standalone card by default. */
export function Metric({
  label,
  value,
  hint,
  tone = "neutral",
  bare = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "good" | "bad";
  /** Render without the card, for use inside one. */
  bare?: boolean;
}) {
  const toneClass = tone === "good" ? "text-gain" : tone === "bad" ? "text-loss" : "text-ink";
  return (
    <div className={bare ? "" : "card p-5"}>
      <div className="eyebrow">{label}</div>
      <div className={`figure mt-1.5 ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs leading-snug text-ink-mute">{hint}</div>}
    </div>
  );
}

/** Money plus percentage, coloured by sign. */
export function Pnl({
  value,
  percent: pct,
  currency = "RUB",
}: {
  value: number;
  percent?: number | null;
  currency?: string;
}) {
  return (
    <span className={`tnum ${pnlClass(value)}`}>
      {signedMoney(value, currency)}
      {pct !== undefined && <span className="ml-2 text-xs">{signedPercent(pct)}</span>}
    </span>
  );
}

/** Pill badge, tinted rather than outlined — the shape Snowball uses. */
export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "bad" | "info" | "warn";
}) {
  const tones = {
    neutral: "bg-sunk text-ink-mute",
    good: "bg-gain/10 text-gain",
    bad: "bg-loss/10 text-loss",
    info: "bg-ice text-accent",
    warn: "bg-warn/10 text-warn",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  const variants = {
    primary: "bg-accent text-white hover:bg-accent-ink disabled:bg-rule-mid",
    ghost:
      "border border-rule-mid bg-surface text-ink hover:border-accent hover:text-accent disabled:text-ink-mute disabled:hover:border-rule-mid",
    danger: "border border-loss/40 bg-loss/5 text-loss hover:bg-loss hover:text-white",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** A quieter inline action. */
export function LinkButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`text-xs text-accent transition-colors hover:text-accent-ink disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-snug text-ink-mute">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-rule bg-sunk px-3 py-2 text-[14px] text-ink " +
  "placeholder:text-ink-faint focus:border-accent focus:bg-surface focus:outline-none";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`${inputClass} appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6z" fill="%237e8299"/></svg>')] bg-[length:10px_6px] bg-[right_10px_center] bg-no-repeat pr-8 ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Notice({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "success" | "info";
}) {
  if (!children) return null;
  const tones = {
    error: "bg-loss/5 border-loss/30 text-loss",
    success: "bg-gain/5 border-gain/30 text-gain",
    info: "bg-ice border-accent/30 text-accent-ink",
  };
  return (
    <div className={`rounded-md border px-3.5 py-2.5 text-sm leading-snug ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="py-10 text-center">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {hint && (
        <p className="mx-auto mt-1.5 max-w-lg text-sm leading-relaxed text-ink-mute">{hint}</p>
      )}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}

export function Rule() {
  return <hr className="border-t border-rule" />;
}

/**
 * `minWidth` is a prop because the same markup serves a full-bleed table and one
 * inside a half-width column. A single fixed minimum either forces a scrollbar
 * in the narrow case or lets columns collapse in the wide one.
 */
export function Table({
  children,
  minWidth = 620,
}: {
  children: ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    // first/last drop the outer padding so the table aligns with the card edge
    // while inner columns still get breathing room.
    <th
      className={`border-b border-rule px-3 pb-2 text-[11px] font-semibold tracking-wide text-ink-mute uppercase first:pl-0 last:pr-0 text-${align}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <td
      className={`border-b border-rule px-3 py-2.5 align-top first:pl-0 last:pr-0 text-${align} ${className}`}
    >
      {children}
    </td>
  );
}

/**
 * The legend that sits beside the donut: a dot, a label, the share and the
 * amount on one line. The chart shows proportion; this reads the numbers.
 */
export function AllocationList({
  items,
  formatValue,
}: {
  items: { key: string; label: string; share: number; value: number; color: string; targetShare?: number }[];
  formatValue: (value: number) => string;
}) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-mute">Нет данных</p>;
  }

  return (
    <div>
      {items.map((item) => (
        <div
          key={item.key}
          className="flex items-baseline justify-between gap-3 border-b border-rule py-2.5 last:border-0"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: item.color }}
            />
            <span className="truncate text-sm text-ink">{item.label}</span>
          </span>
          <span className="tnum shrink-0 text-sm">
            <span className="text-ink-mute">{formatValue(item.value)}</span>
            <span className="ml-3 inline-block w-16 text-right font-semibold text-ink">
              {percent(item.share, 1)}
            </span>
            {item.targetShare !== undefined && item.targetShare > 0 && (
              // Drift against the target, so rebalancing needs no second view.
              <span
                className={`ml-2 inline-block w-14 text-right text-xs ${
                  Math.abs(item.share - item.targetShare) < 0.02 ? "text-ink-faint" : "text-warn"
                }`}
              >
                цель {percent(item.targetShare, 0)}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
