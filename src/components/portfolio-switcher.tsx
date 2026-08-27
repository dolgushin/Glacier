"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Portfolio } from "@/lib/types";

export function PortfolioSwitcher({
  portfolios,
  selectedId,
}: {
  portfolios: Portfolio[];
  selectedId: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (portfolios.length === 0) return null;

  function change(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "all") next.delete("p");
    else next.set("p", value);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <label className="flex items-center gap-2">
      <span className="eyebrow">Портфель</span>
      <select
        value={selectedId === null ? "all" : String(selectedId)}
        onChange={(event) => change(event.target.value)}
        className="appearance-none border-0 border-b border-ink bg-transparent py-0.5 pr-5 pl-0 text-sm font-medium text-ink focus:outline-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22 viewBox=%220 0 10 6%22><path d=%22M0 0l5 6 5-6z%22 fill=%22%23181c32%22/></svg>')] bg-[length:9px_5px] bg-[right_0_center] bg-no-repeat"
      >
        {portfolios.length > 1 && <option value="all">Все портфели</option>}
        {portfolios.map((portfolio) => (
          <option key={portfolio.id} value={portfolio.id}>
            {portfolio.name}
          </option>
        ))}
      </select>
    </label>
  );
}
