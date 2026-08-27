"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "glacier-theme";

/**
 * Runs before first paint, inlined into the document head. Without it the page
 * renders in the default theme and then snaps to the stored one — a flash that
 * is far more noticeable than the toggle itself.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem(${JSON.stringify(KEY)});
    if (t === "light") document.documentElement.setAttribute("data-theme", "light");
  } catch (e) {}
})();
`;

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  // The DOM already carries the right theme from the init script; sync state to it.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "light" ? "light" : "dark");
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    if (next === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode with storage disabled: the toggle still works for this session.
    }
  }

  return (
    <div
      className="flex items-center rounded-md border border-rule p-0.5"
      role="group"
      aria-label="Тема оформления"
    >
      {(
        [
          ["dark", "Тёмная", MoonIcon],
          ["light", "Светлая", SunIcon],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-pressed={theme === value}
          onClick={() => apply(value)}
          className={`flex h-6 w-7 items-center justify-center rounded transition-colors ${
            theme === value ? "bg-raised text-ink" : "text-ink-faint hover:text-ink-mute"
          }`}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5 5.8 5.8 0 1 0 13.5 9.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1" />
      </g>
    </svg>
  );
}
