import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, needsBootstrap } from "@/lib/auth";
import { Mark } from "@/components/mark";
import { RegisterForm } from "./form";

export default async function RegisterPage() {
  if (await currentUser()) redirect("/dashboard");
  const bootstrap = needsBootstrap();

  return (
    <main className="mx-auto grid min-h-screen max-w-[1180px] items-center gap-10 px-5 py-12 sm:px-8 lg:grid-cols-12 lg:gap-16">
      <div className="lg:col-span-7">
        <Mark size={26} className="text-ink" />

        <h1 className="display mt-10">{bootstrap ? "Первый запуск" : "Регистрация"}</h1>
        <p className="mt-5 max-w-md text-[17px] leading-relaxed text-ink-soft">
          {bootstrap
            ? "Создайте учётную запись администратора — она станет владельцем сервиса и сможет выдавать инвайт-коды."
            : "Сервис закрытый. Зарегистрироваться можно только по одноразовому инвайт-коду от администратора."}
        </p>
      </div>

      <div className="lg:col-span-5">
        <div className="card mx-auto w-full max-w-sm p-6 lg:mx-0">
          <div className="eyebrow">{bootstrap ? "Администратор" : "Новый аккаунт"}</div>
          <div className="mt-5">
            <RegisterForm bootstrap={bootstrap} />
          </div>
          {!bootstrap && (
            <p className="mt-6 border-t border-rule pt-4 text-xs text-ink-mute">
              Уже есть аккаунт?{" "}
              <Link href="/login" className="font-medium text-accent hover:text-accent-ink">
                Войти
              </Link>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
