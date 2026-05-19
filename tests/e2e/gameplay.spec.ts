import { expect, test, type Page, type TestInfo } from "@playwright/test";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const screenshotRoot = path.join("test-results", "e2e", "screenshots");

test.describe("Bomberman arena smoke flow", () => {
  test("boots, switches camera modes and completes a bomb cycle", async ({ page }, testInfo) => {
    await page.goto("/");

    await expect(page.getByTestId("arena-hud")).toBeVisible();
    await expect(page.getByTestId("hud-bombs").locator("strong")).toHaveText("1/1");
    await expect(page.getByTestId("hud-radius").locator("strong")).toHaveText("1");
    await capture(page, testInfo, "01-initial-arena");

    await page.getByTestId("view-mode-top_down").click();
    await expect(page.getByTestId("view-mode-top_down")).toHaveAttribute("aria-selected", "true");
    await capture(page, testInfo, "02-top-down");

    await page.getByTestId("view-mode-three_d").click();
    await page.getByTestId("place-bomb-button").click();
    await expect(page.getByTestId("hud-bombs").locator("strong")).toHaveText("0/1");
    await capture(page, testInfo, "03-bomb-warning");

    await expect(page.getByTestId("hud-bombs").locator("strong")).toHaveText("1/1", { timeout: 5_000 });
    await capture(page, testInfo, "04-after-explosion");
  });
});

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await mkdir(screenshotRoot, { recursive: true });
  const filePath = path.join(screenshotRoot, `${name}.png`);
  await page.screenshot({ path: filePath });
  await testInfo.attach(name, {
    path: filePath,
    contentType: "image/png"
  });
}
