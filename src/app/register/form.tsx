"use client";

import { useActionState } from "react";
import { registerAction, type FormState } from "@/app/actions/auth";
import { Button, Field, Input, Notice } from "@/components/ui";

const initial: FormState = {};

export function RegisterForm({ bootstrap }: { bootstrap: boolean }) {
  const [state, action, pending] = useActionState(registerAction, initial);

  return (
    <form action={action} className="space-y-6">
      {state.error && <Notice>{state.error}</Notice>}

      {!bootstrap && (
        <Field label="Инвайт-код" hint="Код выдаёт администратор сервиса">
          <Input
            name="code"
            required
            placeholder="ABCD-EFGH-JKLM"
            autoCapitalize="characters"
            className="code uppercase"
          />
        </Field>
      )}

      <Field label="Имя">
        <Input name="name" required placeholder="Как к вам обращаться" />
      </Field>

      <Field label="Email">
        <Input name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
      </Field>

      <Field label="Пароль" hint="Не короче 8 символов">
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </Field>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Создание…" : bootstrap ? "Создать администратора" : "Зарегистрироваться"}
      </Button>
    </form>
  );
}
