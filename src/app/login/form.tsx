"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "@/app/actions/auth";
import { Button, Field, Input, Notice } from "@/components/ui";

const initial: FormState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <form action={action} className="space-y-6">
      {state.error && <Notice>{state.error}</Notice>}

      <Field label="Email">
        <Input name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
      </Field>

      <Field label="Пароль">
        <Input name="password" type="password" required autoComplete="current-password" />
      </Field>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Вход…" : "Войти"}
      </Button>
    </form>
  );
}
