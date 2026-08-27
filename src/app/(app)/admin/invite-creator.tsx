"use client";

import { useActionState } from "react";
import { createInviteAction, type FormState } from "@/app/actions/auth";
import { Notice, Button, Field, Input, Select } from "@/components/ui";

const initial: FormState = {};

export function InviteCreator() {
  const [state, action, pending] = useActionState(createInviteAction, initial);

  return (
    <div className="space-y-4">
      {state.error && <Notice>{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.success}</Notice>}

      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Field label="Для кого" hint="Комментарий виден только вам">
            <Input name="note" placeholder="Например: Андрей" />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Срок действия">
            <Select name="days" defaultValue="14">
              <option value="3">3 дня</option>
              <option value="14">14 дней</option>
              <option value="30">30 дней</option>
              <option value="365">год</option>
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Создание…" : "Создать инвайт"}
        </Button>
      </form>
    </div>
  );
}
