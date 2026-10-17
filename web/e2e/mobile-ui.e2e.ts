import { test, expect, type Page } from "@playwright/test";

// Phone-layout checks for Phase 5 of the mobile roadmap (tab bar, game dock, move sheet, landscape layout).
// Needs the dev server and API running, like overflow.e2e.ts:  npm run dev   then   npx playwright test mobile-ui
const PORTRAIT = [
  { name: "320x568", width: 320, height: 568 },
  { name: "390x844", width: 390, height: 844 },
];
const LANDSCAPE = { width: 844, height: 390 };

const suffix = Date.now().toString(36);
const USER = { username: `mui${suffix}`, password: "correct horse battery" };
let storage: Awaited<ReturnType<import("@playwright/test").APIRequestContext["storageState"]>>;

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  expect((await api.post("/api/register", { data: USER })).ok()).toBeTruthy();
  storage = await api.storageState();
});

async function phone(browser: import("@playwright/test").Browser, size: { width: number; height: number }) {
  const ctx = await browser.newContext({ storageState: storage, viewport: size, hasTouch: true });
  return { ctx, page: await ctx.newPage() };
}

/** Starts an untimed pass-and-play game from the lobby and waits for the board. */
async function startLocalGame(page: Page) {
  await page.goto("/#/");
  await page.getByRole("button", { name: "No clock" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator(".board cg-board")).toBeVisible();
}

async function playE4(page: Page) {
  const box = (await page.locator(".board cg-board").boundingBox())!;
  const square = box.width / 8;
  await page.mouse.click(box.x + 4.5 * square, box.y + 6.5 * square); // e2
  await page.mouse.click(box.x + 4.5 * square, box.y + 4.5 * square); // e4
}

test("portrait phone: tab bar replaces the header menu, More opens a sheet", async ({ browser }) => {
  const { ctx, page } = await phone(browser, { width: 390, height: 844 });
  await page.goto("/#/");
  const bar = page.getByRole("navigation", { name: "Main" });
  await expect(bar).toBeVisible();
  await expect(page.locator("header .hamburger")).toBeHidden();

  await page.getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Log out" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await ctx.close();
});

test("short landscape phone keeps the header menu and no tab bar", async ({ browser }) => {
  const { ctx, page } = await phone(browser, LANDSCAPE);
  await page.goto("/#/");
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await expect(page.locator("header .hamburger")).toBeVisible();
  await ctx.close();
});

test("desktop never shows the tab bar", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: storage, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto("/#/");
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await ctx.close();
});

for (const size of PORTRAIT) {
  test(`game page at ${size.name}: board and action dock fit on screen`, async ({ browser }) => {
    const { ctx, page } = await phone(browser, size);
    await startLocalGame(page);
    // The tab bar steps aside on the game page; the dock holds the game actions instead.
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

    const board = (await page.locator(".board cg-board").boundingBox())!;
    expect(board.x).toBeGreaterThanOrEqual(0);
    expect(board.x + board.width).toBeLessThanOrEqual(size.width + 1);
    expect(Math.abs(board.width - board.height)).toBeLessThanOrEqual(1);

    const dock = (await page.locator(".game-mobile > .dock").boundingBox())!;
    expect(dock.y + dock.height).toBeLessThanOrEqual(size.height + 1);
    await ctx.close();
  });
}

test("move history opens as a sheet and closes again", async ({ browser }) => {
  const { ctx, page } = await phone(browser, { width: 390, height: 844 });
  await startLocalGame(page);
  const all = page.getByRole("button", { name: "All moves" });
  await expect(all).toBeDisabled(); // nothing to list yet

  await playE4(page);
  await expect(all).toBeEnabled();
  await all.click();
  const sheet = page.getByRole("dialog", { name: "Moves" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "e4" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await ctx.close();
});

test("landscape game: board on the left, controls and move list beside it", async ({ browser }) => {
  const { ctx, page } = await phone(browser, LANDSCAPE);
  await startLocalGame(page);

  const board = (await page.locator(".board cg-board").boundingBox())!;
  const dock = (await page.locator(".game-mobile > .dock").boundingBox())!;
  expect(board.y + board.height).toBeLessThanOrEqual(LANDSCAPE.height + 1);
  expect(dock.x).toBeGreaterThanOrEqual(board.x + board.width - 1); // beside the board, not under it
  expect(dock.y + dock.height).toBeLessThanOrEqual(LANDSCAPE.height + 1);
  await expect(page.locator(".move-panel")).toBeVisible();
  await ctx.close();
});
