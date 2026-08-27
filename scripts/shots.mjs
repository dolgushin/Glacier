/**
 * Screenshots every page with a real session, so a redesign can be judged by
 * looking at it rather than by reading a build log.
 *
 *   node scripts/shots.mjs <session-token> [baseUrl]
 *
 * Uses the locally installed Chrome (channel: "chrome") — no browser download.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const token = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3000";
if (!token) {
  console.error("Нужен токен сессии: node scripts/shots.mjs <token>");
  process.exit(1);
}

const PAGES = [
  ["dashboard", "/dashboard"],
  ["assets", "/assets"],
  ["transactions", "/transactions"],
  ["calendar", "/calendar"],
  ["rebalance", "/rebalance"],
  ["portfolios", "/portfolios"],
  ["connections", "/connections"],
  ["settings", "/settings"],
  ["admin", "/admin"],
];

mkdirSync("shots", { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  locale: "ru-RU",
});

const { hostname } = new URL(base);
await context.addCookies([
  { name: "glacier_session", value: token, domain: hostname, path: "/", httpOnly: true },
]);

const page = await context.newPage();
const problems = [];

// Anything the redesign forbids. Catching it here beats squinting at a mockup.
async function audit(name) {
  return page.evaluate((pageName) => {
    const found = [];
    for (const el of document.querySelectorAll("body *")) {
      const s = getComputedStyle(el);
      // An 8px radius is part of the card language now. A shadow is not: depth
      // here comes from the hairline border, never from a blur.
      if (s.boxShadow && s.boxShadow !== "none") {
        found.push(`shadow on ${el.tagName}.${String(el.className).slice(0, 40)}`);
      }
      if (s.backgroundImage.includes("gradient")) {
        found.push(`gradient on ${el.tagName}.${String(el.className).slice(0, 40)}`);
      }
    }
    const font = getComputedStyle(document.body).fontFamily;
    return { page: pageName, font, violations: [...new Set(found)].slice(0, 6) };
  }, name);
}

for (const [name, path] of PAGES) {
  const response = await page.goto(base + path, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `shots/${name}.png`, fullPage: true });

  const report = await audit(name);
  const status = response?.status() ?? 0;
  console.log(
    `${name.padEnd(14)} HTTP ${status}  шрифт: ${report.font.split(",")[0]}  ` +
      (report.violations.length ? `НАРУШЕНИЯ: ${report.violations.length}` : "чисто"),
  );
  for (const violation of report.violations) console.log(`    · ${violation}`);
  if (report.violations.length) problems.push(name);
}

// Login screen has no session; capture it separately.
const anon = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const anonPage = await anon.newPage();
await anonPage.goto(base + "/login", { waitUntil: "networkidle" });
await anonPage.screenshot({ path: "shots/login.png", fullPage: true });
console.log("login          снят");

await browser.close();
console.log(problems.length ? `\nСтраницы с нарушениями: ${problems.join(", ")}` : "\nВсе страницы чисты.");
