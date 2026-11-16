import { expect, test, type Page } from "@playwright/test";
import { stripTop } from "./strip";

// lina-app#143: a goal chosen in 대화 stays in 대화, the phone's last goal row clears the field and the strip, and the
// selected top tab shows the same way at every width in dark.
const APP = "/app/?source=synthetic";

async function openFirstAgent(page: Page, phone: boolean): Promise<void> {
  await page.goto(`${APP}#/talk`);
  await page.getByTestId(phone ? "talk-agent-0" : "nav-talk-0").getByRole("link").click();
  await expect(page.getByTestId("agent-talk")).toBeVisible();
}

test("a goal chosen on the agent's card opens under 대화, and back returns to the talk", async ({ page }, info) => {
  const phone = info.project.name === "phone";
  await openFirstAgent(page, phone);
  const card = page.getByTestId("agent-card");
  if (phone) await card.getByRole("button").first().click();
  await card.getByRole("link", { name: /릴리스 노트 정리/ }).click();
  await expect(page.locator("article.detail .detail-title")).toHaveText("릴리스 노트 정리");
  expect(new URL(page.url()).hash).toBe("#/talk/ag-1?goal=G1");
  if (phone) await expect(page.getByTestId("agent-talk")).toHaveCount(0);
  else {
    await expect(page.getByTestId("tab-talk")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("agent-talk")).toBeVisible();
  }
  await page.getByTestId("back").click();
  await expect(page.getByTestId("agent-talk")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/talk/ag-1");
});

test("on a wide window each agent row keeps its counts inside the sidebar under its last message", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "wide sidebar only");
  await page.goto(`${APP}#/talk`);
  const row = page.getByTestId("nav-talk-1");
  await expect(row.getByTestId("talk-preview")).toHaveText("아직 나눈 대화 없음");
  const sidebar = (await page.locator(".sidebar").boundingBox())!;
  for (const count of await row.locator(".talk-running, .talk-stopped").all()) {
    const box = (await count.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
  }
  // Both counts read in words, never a bare number (lina-app#207, #219).
  await expect(row.getByTestId("talk-running")).toHaveText("진행 중 1");
  await expect(row.getByTestId("talk-stopped")).toHaveText("중단됨 1");
});

test("an agent row's counts sit on its name line and its preview has the row's whole width (lina-app#219)", async ({ page }, info) => {
  await page.goto(`${APP}#/talk`);
  const row = (index: number) => page.getByTestId(info.project.name === "phone" ? `talk-agent-${index}` : `nav-talk-${index}`);
  await expect(row(1).getByTestId("talk-preview")).toHaveText("아직 나눈 대화 없음");
  const width = async (index: number) => (await row(index).getByTestId("talk-preview").boundingBox())!.width;
  // Row 1 has counts, row 2 none: the same preview width on both.
  expect(Math.abs((await width(1)) - (await width(2)))).toBeLessThanOrEqual(1);
  const counts = (await row(1).getByTestId("talk-stopped").boundingBox())!;
  const preview = (await row(1).getByTestId("talk-preview").boundingBox())!;
  expect(counts.y + counts.height).toBeLessThanOrEqual(preview.y + 1);
  // A preview that fits is whole; only one longer than the row ends in an ellipsis.
  const fits = await row(1).getByTestId("talk-preview").evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits).toBe(true);
  await expect(row(0).getByTestId("talk-preview")).toHaveCSS("text-overflow", "ellipsis");
});

test("on a wide window with no agent chosen, the middle takes the whole width: no empty right column (lina-app#150)", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "wide panes only");
  await page.goto(`${APP}#/talk`);
  await expect(page.getByTestId("pick-agent")).toBeVisible();
  const panes = (await page.getByTestId("panes").boundingBox())!;
  const middle = (await page.locator(".talk-pane").boundingBox())!;
  expect(Math.round(middle.width)).toBe(Math.round(panes.width));
});

test("on a phone the last goal row is fully visible above the field and the strip", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone layout only");
  // The synthetic agent has two goals; a short window makes the open card longer than the screen, as 19 goals do.
  await page.setViewportSize({ width: 390, height: 420 });
  await openFirstAgent(page, true);
  const card = page.getByTestId("agent-card");
  await card.getByRole("button").first().click();
  const last = card.locator(".goal-row").last();
  const clear = async () => {
    const row = await last.boundingBox();
    const form = await page.locator(".agent-talk-form").boundingBox();
    const strip = await stripTop(page);
    expect(row && form).toBeTruthy();
    expect(row!.y).toBeGreaterThanOrEqual(0);
    expect(row!.y + row!.height).toBeLessThanOrEqual(form!.y);
    expect(row!.y + row!.height).toBeLessThanOrEqual(strip);
  };
  // Scrolled down just far enough to bring the row in (as a focus move or a find does), then to the end.
  await last.evaluate((row) => row.scrollIntoView({ block: "end" }));
  await clear();
  await page.locator(".phone-main").evaluate((main) => (main.scrollTop = main.scrollHeight));
  await clear();
});

test("the top tabs stay put between the 대화 list, an open agent and the other tabs' first screens, light and dark (lina-app#223)", async ({ page }, info) => {
  const phone = info.project.name === "phone";
  const place = () => page.getByTestId("tabs").boundingBox();
  // The bar the tabs stand in: the wide toolbar, the phone's navbar over the large title.
  const bar = () => page.locator(phone ? ".navbar" : ".toolbar").boundingBox();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(`${APP}#/talk`);
    await expect(page.getByTestId(phone ? "talk-agent-0" : "nav-talk-0")).toBeVisible();
    const list = await place();
    const listBar = await bar();
    console.log(`tabs ${info.project.name} ${colorScheme} list: tabs ${JSON.stringify(list)} bar ${JSON.stringify(listBar)}`);
    // The bar keeps its box when an agent opens. On a phone the tabs stand on each tab's first screen only; an open
    // agent's bar has none.
    await page.goto(`${APP}#/talk/ag-1`);
    await expect(page.getByTestId("agent-talk")).toBeVisible();
    await expect.poll(bar, { message: `${colorScheme} bar with an agent open` }).toEqual(listBar);
    if (phone) await expect(page.getByTestId("tabs")).toHaveCount(0);
    else await expect.poll(place, { message: `${colorScheme} tabs with an agent open` }).toEqual(list);
    console.log(`tabs ${info.project.name} ${colorScheme} agent open: tabs ${JSON.stringify(phone ? null : await place())} bar ${JSON.stringify(await bar())}`);
    for (const hash of ["#/", "#/status"]) {
      await page.goto(`${APP}${hash}`);
      await expect.poll(place, { message: `${colorScheme} ${hash}` }).toEqual(list);
    }
  }
});

// lina-app#232: in dark at 1280 the current sidebar row's white words on its fill measured 3.65:1 and an agent row's red
// count 4.09:1. Both need 4.5:1 as the page draws them: the computed colour over every background under it.
test("the current sidebar row's words and the agent rows' red counts reach 4.5:1 as drawn in dark at 1280 (lina-app#232)", async ({ page }, info) => {
  test.skip(info.project.name !== "wide-dark", "dark wide sidebar only");
  // Each element that draws words of its own under the selector, with its contrast on what it is drawn over.
  const drawn = (selector: string) =>
    page.locator(selector).evaluateAll((all) => {
      // The current row's fill fades in (--motion); measure the colours it settles on.
      for (const animation of document.getAnimations()) animation.finish();
      const elements = all.filter((element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim()));
      type Rgba = [number, number, number, number];
      const parse = (value: string): Rgba => {
        const [r, g, b, a = 1] = value.match(/[\d.]+/g)!.map(Number);
        return [r, g, b, a];
      };
      const over = (top: Rgba, bottom: Rgba): Rgba => [0, 1, 2].map((index) => top[index] * top[3] + bottom[index] * (1 - top[3])).concat(1) as Rgba;
      const luminance = ([r, g, b]: Rgba) =>
        [r, g, b].map((value) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4)).reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
      return elements.map((element) => {
        // Every background from the element up to the first opaque one, then laid over each other from the bottom.
        const layers: Rgba[] = [];
        for (let at: Element | null = element; at && (layers.length === 0 || layers[layers.length - 1][3] < 1); at = at.parentElement) {
          const colour = parse(getComputedStyle(at).backgroundColor);
          if (colour[3] > 0) layers.push(colour);
        }
        const surface = layers.reduceRight((under, layer) => over(layer, under), [0, 0, 0, 1] as Rgba);
        const text = over(parse(getComputedStyle(element).color), surface);
        const [a, b] = [luminance(text), luminance(surface)];
        return { text: element.textContent, colour: getComputedStyle(element).color, surface: surface.slice(0, 3).map(Math.round).join(","), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
    });
  // The red count stands plain on the sidebar in a row that is not open, and white on red in the open one.
  const stopped = await page.goto(`${APP}#/talk`).then(() => page.getByTestId("nav-talk-1").getByRole("link").getAttribute("href"));
  for (const hash of ["#/talk/ag-1", stopped!]) {
    await page.goto(`${APP}${hash}`);
    await expect(page.getByTestId("agent-talk")).toBeVisible();
    await expect(page.locator(".sidebar .nav-row.is-current a")).toHaveCount(1);
    const words = await drawn(".sidebar .nav-row.is-current a, .sidebar .nav-row.is-current a *");
    const counts = await drawn(".sidebar [data-testid=talk-stopped]");
    expect(words.length, hash).toBeGreaterThan(0);
    expect(counts.length, hash).toBeGreaterThan(0);
    for (const each of [...words, ...counts]) {
      console.log(`contrast ${hash} ${JSON.stringify(each)}`);
      expect(each.ratio, `${hash} ${JSON.stringify(each)}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("the selected top tab is drawn the same at every width and stands apart from its neighbours", async ({ page }, info) => {
  test.skip(info.project.name !== "wide-dark", "one dark pass resizes between widths");
  const look = async () =>
    page.getByTestId("tabs").locator("a").evaluateAll((tabs) => tabs.map((tab) => ({ current: tab.getAttribute("aria-current") === "page", background: getComputedStyle(tab).backgroundColor })));
  await page.goto(`${APP}#/talk`);
  const wide = await look();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("[data-layout=phone]")).toBeVisible();
  const narrow = await look();
  expect(narrow).toEqual(wide);
  const selected = narrow.find((tab) => tab.current)!.background;
  for (const tab of narrow.filter((each) => !each.current)) expect(tab.background).not.toBe(selected);
  expect(selected).toBe("rgb(115, 115, 119)");
});
