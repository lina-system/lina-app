import { expect, test } from "@playwright/test";

// lina-app#157 item 8: on a phone the detail sheet hides the screen it was opened from all the way up to the bar: the
// strip above the sheet's grab handle looks the same whether that screen's large title is there or not.
for (const colorScheme of ["light", "dark"] as const) {
  test(`on a phone nothing of the screen behind shows above the sheet's grab handle (${colorScheme})`, async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phone layout only");
    await page.emulateMedia({ colorScheme });
    await page.goto("/app/?source=synthetic#/inbox");
    await expect(page.getByTestId("freshness-line")).toHaveText("");
    await expect(page.locator(".phone-main .large-title")).toBeVisible();
    await page.locator("[data-testid=screen-inbox] .decision-row > a").first().click();
    const frame = page.getByTestId("detail-frame");
    await expect(frame).toHaveAttribute("data-frame", "sheet");
    await frame.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const bar = (await page.locator(".navbar").boundingBox())!;
    const grabber = (await page.locator(".detail-sheet-grabber").boundingBox())!;
    const clip = { x: 24, y: bar.y + bar.height, width: 390 - 48, height: grabber.y - (bar.y + bar.height) };
    expect(clip.height).toBeGreaterThan(0);
    const withScreen = await page.screenshot({ clip, animations: "disabled" });
    await page.locator(".phone-main").evaluate((main) => (main.style.visibility = "hidden"));
    const withoutScreen = await page.screenshot({ clip, animations: "disabled" });
    expect(withScreen.equals(withoutScreen), "the screen behind the sheet shows through above its handle").toBe(true);
  });
}
