import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/app/actions/auth";
import { NavLinks } from "@/components/nav";
import { Wordmark } from "@/components/mark";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-screen">
      {/* White bar over the grey field, held by the same hairline as the cards. */}
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
          <div className="flex items-center justify-between gap-6 border-b border-rule py-3.5">
            <Link href="/dashboard">
              <Wordmark />
            </Link>
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-ink-mute sm:inline">
                {user.name || user.email}
              </span>
              <ThemeToggle />
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="rounded-md border border-rule px-2.5 py-1.5 text-[11px] font-semibold tracking-wide text-ink-mute uppercase transition-colors hover:border-accent hover:text-accent"
                >
                  Выйти
                </button>
              </form>
            </div>
          </div>
          <NavLinks isAdmin={user.role === "admin"} />
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 py-6 sm:px-8">{children}</main>

      <footer className="mx-auto max-w-[1180px] px-5 pb-10 sm:px-8">
        <div className="pt-2 text-[11px] leading-relaxed text-ink-faint">
          Glacier — личный инструмент учёта. Представленная информация носит справочный характер
          и не является индивидуальной инвестиционной рекомендацией.
        </div>
      </footer>
    </div>
  );
}
