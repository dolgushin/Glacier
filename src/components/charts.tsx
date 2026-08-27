"use client";

import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money, monthLabel, percent } from "@/lib/format";

/*
 * Charts, set to the same discipline as the rest.
 *
 * No gradient fills, no drop shadows, no legend pills. The donut carries the
 * proportion and nothing else — labels and figures live in the list beside it,
 * where they can be read instead of decoded.
 */

/*
 * Colours are var() references, not literals: SVG paint attributes resolve CSS
 * variables, so the charts follow the theme toggle without a re-render or a
 * second palette to keep in sync.
 */
const INK = "var(--color-ink)";
const ACCENT = "var(--color-accent)";
const GAIN = "var(--color-gain)";
const RULE = "var(--color-rule)";
const ICE = "var(--color-ice)";
const MUTE = "var(--color-ink-faint)";
const SURFACE = "var(--color-surface)";
/* Neutral hover wash that reads on either theme. */
const CURSOR_WASH = "rgba(128,128,140,0.14)";

const AXIS = { fill: MUTE, fontSize: 11, fontFamily: "var(--font-mono)" };

const TOOLTIP = {
  contentStyle: {
    background: SURFACE,
    border: `1px solid ${RULE}`,
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 12,
    fontFamily: "var(--font-sans)",
    boxShadow: "none",
  },
  labelStyle: {
    color: MUTE,
    marginBottom: 4,
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  },
  itemStyle: { color: INK, padding: 0 },
  cursor: { stroke: MUTE, strokeWidth: 1, strokeDasharray: "2 3" },
};

/** 1 234 567 -> "1,2 млн" so the axis never wraps. */
function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)} млрд`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)} млн`;
  if (abs >= 1e3) return `${Math.round(value / 1e3)} тыс`;
  return String(Math.round(value));
}

export function ValueChart({
  data,
  currency,
}: {
  data: { date: string; value: number; invested: number }[];
  currency: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="date"
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: RULE, strokeWidth: 1 }}
          minTickGap={48}
          tickFormatter={(value: string) => value.slice(5)}
          dy={6}
        />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={58}
          tickFormatter={compact}
          // A horizontal hairline per tick reads better than a full grid.
          tickMargin={8}
        />
        <Tooltip
          {...TOOLTIP}
          formatter={(value: number, name: string) => [
            money(value, currency),
            name === "value" ? "Стоимость" : "Вложено",
          ]}
        />
        <Line
          type="linear"
          dataKey="invested"
          stroke={MUTE}
          strokeWidth={1}
          strokeDasharray="3 3"
          dot={false}
          activeDot={false}
        />
        <Line
          type="linear"
          dataKey="value"
          stroke={ACCENT}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3.5, fill: ACCENT, stroke: SURFACE, strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export interface Slice {
  key: string;
  label: string;
  value: number;
  share: number;
  color: string;
}

export function DonutChart({
  data,
  currency,
  height = 210,
}: {
  data: Slice[];
  currency: string;
  height?: number;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-mute">Нет данных</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius="62%"
          outerRadius="94%"
          paddingAngle={1.5}
          stroke="none"
          isAnimationActive={false}
        >
          {data.map((slice) => (
            <Cell key={slice.key} fill={slice.color} />
          ))}
        </Pie>
        <Tooltip
          {...TOOLTIP}
          cursor={false}
          formatter={(value: number, _name: string, entry: { payload?: Slice }) => [
            `${money(value, currency)} · ${percent(entry.payload?.share ?? 0, 1)}`,
            entry.payload?.label ?? "",
          ]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function PayoutBars({
  data,
  currency,
}: {
  data: { month: string; announced: number; forecast: number }[];
  currency: string;
}) {
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-mute">
        Нет ожидаемых выплат в ближайшие 12 месяцев
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
        <XAxis
          dataKey="month"
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: RULE, strokeWidth: 1 }}
          tickFormatter={monthLabel}
          dy={6}
        />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={58} tickFormatter={compact} />
        <Tooltip
          {...TOOLTIP}
          cursor={{ fill: CURSOR_WASH }}
          labelFormatter={monthLabel}
          formatter={(value: number, name: string) => [
            money(value, currency),
            name === "announced" ? "Объявлено" : "Прогноз",
          ]}
        />
        {/* Announced payments are solid; a forecast is an outline. */}
        <Bar dataKey="announced" stackId="p" fill={ACCENT} />
        <Bar dataKey="forecast" stackId="p" fill={ICE} stroke={ACCENT} strokeWidth={1} radius={[3,3,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function YearBars({
  data,
  currency,
}: {
  data: { year: string; amount: number }[];
  currency: string;
}) {
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-mute">Выплаты ещё не поступали</p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap="42%">
        <XAxis
          dataKey="year"
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: RULE, strokeWidth: 1 }}
          dy={6}
        />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={58} tickFormatter={compact} />
        <Tooltip
          {...TOOLTIP}
          cursor={{ fill: CURSOR_WASH }}
          formatter={(value: number) => [money(value, currency), "Получено"]}
        />
        {/* Money actually received is growth — same colour as a positive P&L. */}
        <Bar dataKey="amount" fill={GAIN} radius={[3,3,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
