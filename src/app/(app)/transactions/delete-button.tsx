"use client";

import { useActionState } from "react";
import { deleteTransactionAction, type ActionState } from "@/app/actions/data";

const initial: ActionState = {};

export function DeleteTransactionButton({ transactionId }: { transactionId: number }) {
  const [, action, pending] = useActionState(deleteTransactionAction, initial);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!confirm("Удалить операцию? Все показатели будут пересчитаны.")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="transactionId" value={transactionId} />
      <button
        type="submit"
        disabled={pending}
        title="Удалить операцию"
        className="px-2 py-1 text-xs text-ink-mute transition-colors hover:bg-surface hover:text-loss disabled:opacity-50"
      >
        ✕
      </button>
    </form>
  );
}
