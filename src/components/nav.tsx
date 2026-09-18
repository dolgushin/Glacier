"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Обзор" },
  { href: "/assets", label: "Активы" },
  { href: "/transactions", label: "Сделки" },
  { href: "/calendar", label: "Выплаты" },
  { href: "/rebalance", label: "Баланс" },
  { href: "/taxes", label: "Налоги" },
  { href: "/portfolios", label: "Портфели" },
  { href: "/connections", label: "Брокеры" },
  { href: "/settings", label: "Настройки" },
];

/**
 * Navigation as a running head: small caps, wide tracking, the active item
 * marked by a rule under the word rather than by a filled pill.
 */
export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const links = isAdmin ? [...LINKS, { href: "/admin", label: "Админка" }] : LINKS;

  return (
    <nav className="-mb-px flex min-w-0 flex-1 items-stretch gap-6 overflow-x-auto">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`shrink-0 border-b-2 pt-1 pb-2.5 text-[11px] font-semibold tracking-[0.13em] uppercase transition-colors ${
              active
                ? "border-ink text-ink"
                : "border-transparent text-ink-mute hover:text-ink"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
