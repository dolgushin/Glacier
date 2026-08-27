import type { Metadata, Viewport } from "next";
import { Golos_Text, IBM_Plex_Mono } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/components/theme-toggle";
import "./globals.css";

/*
 * Golos Text: a Russian neo-grotesque with real Cyrillic, close in spirit to the
 * Swiss grotesques the layout is built on. Inter would have been the default
 * choice, which is exactly the reason not to use it.
 *
 * IBM Plex Mono carries tickers and dense figures — a ledger reads better when
 * the codes are monospaced.
 */
const golos = Golos_Text({
  subsets: ["latin", "cyrillic"],
  variable: "--font-golos",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Glacier — учёт инвестиций",
  description: "Личный сервис учёта и аналитики инвестиционного портфеля",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#282832" },
    { media: "(prefers-color-scheme: light)", color: "#f9fafb" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${golos.variable} ${plexMono.variable}`}>
      <head>
        {/* Applies the stored theme before first paint, so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
