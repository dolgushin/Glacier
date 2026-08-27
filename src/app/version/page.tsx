/**
 * Diagnostic page. Exists so that "I don't see the changes" can be settled with
 * a fact instead of a guess: it prints the palette the server is actually
 * serving, in a form that cannot be mistaken for anything else.
 */
export const dynamic = "force-dynamic";

/**
 * Token names rather than hex values: both are correct, but only the token is
 * correct in both themes at once.
 */
const SWATCHES: [string, string][] = [
  ["Фон страницы", "bg-paper"],
  ["Поверхность", "bg-surface"],
  ["Приглушённая", "bg-sunk"],
  ["Приподнятая", "bg-raised"],
  ["Заголовки", "bg-ink"],
  ["Основной текст", "bg-ink-soft"],
  ["Приглушённый", "bg-ink-mute"],
  ["Акцент", "bg-accent"],
  ["Рост", "bg-gain"],
  ["Падение", "bg-loss"],
  ["Предупреждение", "bg-warn"],
  ["Линейка", "bg-rule"],
];

export default function VersionPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <div className="card p-6">
        <div className="eyebrow">Диагностика оформления</div>
        <h1 className="display mt-3">Палитра Snowball</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-ink-soft">
          Обе темы сняты с публичного портфеля Snowball. Переключатель — в шапке приложения;
          выбор запоминается и применяется до первой отрисовки, без вспышки.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span className="rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-white">
            Синяя кнопка
          </span>
          <span className="text-gain figure">+12,4 %</span>
          <span className="text-loss figure">−8,1 %</span>
        </div>
      </div>

      <div className="card mt-4 p-6">
        <div className="eyebrow">Цвета</div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {SWATCHES.map(([label, className]) => (
            <div key={className}>
              <div className={`h-12 w-full rounded-md border border-rule ${className}`} />
              <div className="mt-2 text-sm text-ink">{label}</div>
              <div className="code text-xs text-ink-mute">{className}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card mt-4 p-6">
        <div className="eyebrow">Проверка</div>
        <ul className="mt-3 space-y-2 text-sm text-ink-soft">
          <li>· Карточки со скруглением 8px и волосяной рамкой, без теней</li>
          <li>
            · Числа: <span className="code tnum">1 234 567,89 ₽</span> — моноширинные, табличные
          </li>
          <li>
            · Шрифт интерфейса — Golos Text, тикеры — <span className="code">SBER GAZP</span>
          </li>
        </ul>
        <p className="mt-5 border-t border-rule pt-4 text-xs text-ink-mute">
          Открыто: {new Date().toLocaleString("ru-RU")} · страница генерируется при каждом
          запросе, поэтому время всегда текущее.
        </p>
      </div>
    </main>
  );
}
