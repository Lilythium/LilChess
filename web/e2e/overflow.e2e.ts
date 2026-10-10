import { test, expect, type Page } from "@playwright/test";

const SIZES = [
  { name: "320x568", width: 320, height: 568 },
  { name: "360x740", width: 360, height: 740 },
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "844x390 landscape", width: 844, height: 390 },
];

const suffix = Date.now().toString(36);
const A = { username: `mva${suffix}`, password: "correct horse battery" };
const B = { username: `mvb${suffix}`, password: "correct horse battery" };

let storageA: Awaited<ReturnType<import("@playwright/test").APIRequestContext["storageState"]>>;
let gameId = "";
let tournamentId = "";

test.beforeAll(async ({ playwright, baseURL }) => {
  const a = await playwright.request.newContext({ baseURL });
  const b = await playwright.request.newContext({ baseURL });
  expect((await a.post("/api/register", { data: A })).ok()).toBeTruthy();
  expect((await b.post("/api/register", { data: B })).ok()).toBeTruthy();

  const ch = await a.post("/api/challenges", { data: { mode: "live", initialMs: 300000, incrementMs: 3000 } });
  const { challengeId } = await ch.json();
  gameId = (await (await b.post(`/api/challenges/${challengeId}/accept`)).json()).gameId;

  await a.post("/api/tournaments", {
    data: { name: "Mobile check", format: "round_robin", mode: "live", initialMs: 300000, incrementMs: 3000,
            maxPlayers: 4, variant: "standard", rated: false },
  });
  tournamentId = (await (await a.get("/api/tournaments")).json()).tournaments[0]?.id ?? "";
  storageA = await a.storageState();
});

async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrollers = ".table-scroll, .bracket, .tabs, .moves";
    const bad = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > vw + 1 || r.left < -1) && !el.closest(scrollers);
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className)}`);
    return { scrollWidth: document.documentElement.scrollWidth, vw, bad };
  });
}

for (const size of SIZES) {
  test(`no horizontal overflow at ${size.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageA, viewport: size, hasTouch: true });
    const page = await ctx.newPage();
    const routes = ["/", "/games", "/watch", "/tournaments", "/leaderboard", "/leaderboard/chess960",
      "/settings", "/local", `/u/${A.username}`, `/game/${gameId}`, `/tournament/${tournamentId}`];

    for (const route of routes) {
      await page.goto(`/#${route}`);
      await page.waitForLoadState("networkidle");
      const r = await overflow(page);
      expect(r.scrollWidth, `${route}: page scrolls sideways`).toBeLessThanOrEqual(r.vw);
      expect(r.bad, `${route}: elements outside the viewport`).toEqual([]);
    }
    await ctx.close();
  });
}