import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, needsBootstrap } from "@/lib/auth";
import { Mark } from "@/components/mark";
import { LoginForm } from "./form";

export default async function LoginPage() {
  if (await currentUser()) redirect("/dashboard");
  // With no accounts at all, the only sensible destination is first-run setup.
  if (needsBootstrap()) redirect("/register");

  return (
    <main className="mx-auto grid min-h-screen max-w-[1180px] items-center gap-10 px-5 py-12 sm:px-8 lg:grid-cols-12 lg:gap-16">
      <div className="lg:col-span-7">
        <Mark size={26} className="text-ink" />

        <h1 className="display mt-10">Glacier</h1>
        <p className="mt-5 max-w-md text-[17px] leading-relaxed text-ink-soft">
          Учёт и аналитика инвестиционного портфеля. Сделки, дивиденды, настоящая доходность —
          в одном месте.
        </p>

        <dl className="mt-12 grid max-w-lg grid-cols-3 gap-4">
          {[
            ["Метод", "FIFO по лотам"],
            ["Доходность", "XIRR"],
            ["Источники", "MOEX · ЦБ РФ"],
          ].map(([label, value]) => (
            <div key={label} className="card p-4">
              <dt className="eyebrow">{label}</dt>
              <dd className="mt-1 text-sm text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="lg:col-span-5">
        <div className="card mx-auto w-full max-w-sm p-6 lg:mx-0">
          <div className="eyebrow">Вход</div>
          <div className="mt-5">
            <LoginForm />
          </div>
          <p className="mt-6 border-t border-rule pt-4 text-xs text-ink-mute">
            Есть инвайт-код?{" "}
            <Link href="/register" className="font-medium text-accent hover:text-accent-ink">
              Зарегистрироваться
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
