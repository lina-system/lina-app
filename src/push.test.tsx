import { act, fireEvent, render, waitFor, within } from "@testing-library/preact";
import { describe, expect, test, vi } from "vitest";
import type { PushSubscriptionRequest, PushSubscriptionResult } from "./api/client";
import { App } from "./app";
import type { WriteResult } from "./data/source";
import { Store } from "./data/store";
import { SYNTHETIC_PUSH_KEY, SyntheticPushManager, SyntheticSource } from "./data/synthetic-source";
import { base64UrlBytes, subscriptionBody, type CloseMatch, type OpenRequest, type PushHost, type PushManagerLike } from "./push";
import { Actions } from "./ui/actions";

/** The browser around the row: platform, permission, a push manager (null: none) and the service worker's seams. */
function browser(options: { ios?: boolean; standalone?: boolean; permission?: NotificationPermission | null; answer?: NotificationPermission; manager?: PushManagerLike | null } = {}) {
  let permission = options.permission === undefined ? "default" : options.permission;
  const manager = options.manager === undefined ? new SyntheticPushManager() : options.manager;
  const asked: NotificationPermission[] = [];
  const closed: CloseMatch[] = [];
  const listeners = new Set<(open: OpenRequest) => void>();
  const host: PushHost = {
    ios: options.ios ?? false,
    standalone: () => options.standalone ?? false,
    permission: () => permission,
    async requestPermission() {
      permission = options.answer ?? "granted";
      asked.push(permission);
      return permission;
    },
    manager: async () => manager,
    close: (match) => closed.push(match),
    onOpen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { host, manager, asked, closed, open: (request: OpenRequest) => listeners.forEach((listener) => listener(request)) };
}

function setWide() {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function openBell(source: SyntheticSource, host: PushHost, hash = "#/inbox") {
  setWide();
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} pushHost={host} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("실시간"));
  fireEvent.click(view.getByTestId("bell"));
  const notices = view.getByTestId("notices");
  await waitFor(() => expect(within(notices).getByTestId("push-row")).toBeTruthy());
  return { view, row: () => within(view.getByTestId("notices")).getByTestId("push-row") };
}

describe("알림 받기", () => {
  test("push off in the core: one line, no switch", async () => {
    const { row } = await openBell(new SyntheticSource({ pushOff: true }), browser().host);
    expect(row().dataset.state).toBe("off");
    expect(within(row()).getByTestId("push-line").textContent).toBe("푸시 설정 안 됨");
    expect(within(row()).queryByRole("switch")).toBeNull();
  });

  test("on iOS outside the Home Screen: how to add it, no switch, and the core is not asked", async () => {
    const source = new SyntheticSource();
    const pushKey = vi.spyOn(source, "pushKey");
    const { row } = await openBell(source, browser({ ios: true, standalone: false }).host);
    expect(row().dataset.state).toBe("home");
    expect(within(row()).getByTestId("push-line").textContent).toBe("공유 › 홈 화면에 추가 후 켤 수 있음");
    expect(within(row()).queryByRole("switch")).toBeNull();
    expect(pushKey).not.toHaveBeenCalled();
  });

  test("on iOS from the Home Screen, and on a desktop browser: the switch, off, and nothing asked on load", async () => {
    for (const device of [browser({ ios: true, standalone: true }), browser()]) {
      const { view, row } = await openBell(new SyntheticSource(), device.host);
      await waitFor(() => expect(row().dataset.state).toBe("ready"));
      expect(within(row()).getByRole("switch", { name: "알림 받기" }).getAttribute("aria-checked")).toBe("false");
      expect(within(row()).queryByTestId("push-line")).toBeNull();
      expect(device.asked).toEqual([]);
      view.unmount();
    }
  });

  test("a browser without Web Push, and notifications blocked in the browser: one line each, no switch", async () => {
    for (const [device, state, line] of [
      [browser({ manager: null }), "unsupported", "이 브라우저는 받을 수 없음"],
      [browser({ permission: null }), "unsupported", "이 브라우저는 받을 수 없음"],
      [browser({ permission: "denied" }), "blocked", "브라우저에서 알림 막힘"],
    ] as const) {
      const { view, row } = await openBell(new SyntheticSource(), device.host);
      await waitFor(() => expect(row().dataset.state).toBe(state));
      expect(within(row()).getByTestId("push-line").textContent).toBe(line);
      expect(within(row()).queryByRole("switch")).toBeNull();
      view.unmount();
    }
  });

  test("turning it on asks once, subscribes with the core's key and sends it; off removes it in the core and unsubscribes", async () => {
    const source = new SyntheticSource();
    const device = browser();
    const subscribe = vi.spyOn(device.manager as SyntheticPushManager, "subscribe");
    const { row } = await openBell(source, device.host);
    await waitFor(() => expect(row().dataset.state).toBe("ready"));
    fireEvent.click(within(row()).getByRole("switch", { name: "알림 받기" }));
    await waitFor(() => expect(row().dataset.state).toBe("on"));
    expect(device.asked).toEqual(["granted"]);
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: base64UrlBytes(SYNTHETIC_PUSH_KEY) });
    const held = await device.manager!.getSubscription();
    expect([...source.push.subscriptions.keys()]).toEqual([held!.endpoint]);
    expect(within(row()).getByRole("switch").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(within(row()).getByRole("switch", { name: "알림 받기" }));
    await waitFor(() => expect(row().dataset.state).toBe("ready"));
    expect(source.push.subscriptions.size).toBe(0);
    expect(await device.manager!.getSubscription()).toBeNull();

    fireEvent.click(within(row()).getByRole("switch", { name: "알림 받기" }));
    await waitFor(() => expect(row().dataset.state).toBe("on"));
    expect(device.asked).toEqual(["granted"]);
  });

  test("permission refused at the prompt: the blocked line, nothing subscribed", async () => {
    const source = new SyntheticSource();
    const device = browser({ answer: "denied" });
    const { row } = await openBell(source, device.host);
    await waitFor(() => expect(row().dataset.state).toBe("ready"));
    fireEvent.click(within(row()).getByRole("switch", { name: "알림 받기" }));
    await waitFor(() => expect(row().dataset.state).toBe("blocked"));
    expect(source.push.subscriptions.size).toBe(0);
    expect(await device.manager!.getSubscription()).toBeNull();
  });

  test("a later visit sends a subscription whose endpoint changed, without asking", async () => {
    const source = new SyntheticSource();
    const device = browser({ permission: "granted" });
    const first = await device.manager!.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlBytes(SYNTHETIC_PUSH_KEY) });
    source.push.subscriptions.set(first.endpoint, subscriptionBody(first)!);
    (device.manager as SyntheticPushManager).rotate();
    const changed = await device.manager!.getSubscription();
    const { row } = await openBell(source, device.host);
    await waitFor(() => expect(row().dataset.state).toBe("on"));
    expect(source.push.subscriptions.has(changed!.endpoint)).toBe(true);
    expect(changed!.endpoint).not.toBe(first.endpoint);
    expect(device.asked).toEqual([]);
  });

  test("a subscription the core refuses is dropped again, and the row says it did not turn on", async () => {
    class Refusing extends SyntheticSource {
      override async savePushSubscription(): Promise<WriteResult<PushSubscriptionResult>> {
        return { ok: false, status: 429, detail: "too many writes" };
      }
    }
    const device = browser();
    const { row } = await openBell(new Refusing(), device.host);
    await waitFor(() => expect(row().dataset.state).toBe("ready"));
    fireEvent.click(within(row()).getByRole("switch", { name: "알림 받기" }));
    await waitFor(() => expect(within(row()).getByTestId("push-error").textContent).toBe("켜지 못함"));
    expect(row().dataset.state).toBe("ready");
    expect(await device.manager!.getSubscription()).toBeNull();
  });

  test("the core's checks hold for the synthetic core too: an endpoint on an unknown host is refused", async () => {
    const source = new SyntheticSource();
    const body: PushSubscriptionRequest = { endpoint: "https://push.example.com/x", keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) } };
    expect(await source.savePushSubscription(body)).toMatchObject({ ok: false, status: 400 });
    expect(await new SyntheticSource({ pushOff: true }).savePushSubscription({ ...body, endpoint: "https://fcm.googleapis.com/fcm/send/x" })).toMatchObject({ ok: false, status: 503 });
  });
});

describe("notifications on this device", () => {
  test("a notice read in the bell, and 모두 읽음, close its notification here at once", async () => {
    const source = new SyntheticSource();
    const device = browser();
    const { view } = await openBell(source, device.host);
    const key = source.scene.board.notices.find((notice) => !notice.read)!.key;
    fireEvent.click(within(view.getByTestId("notices")).getAllByRole("link")[source.scene.board.notices.findIndex((notice) => notice.key === key)]);
    await waitFor(() => expect(device.closed).toEqual([{ tags: [key] }]));
    fireEvent.click(view.getByTestId("bell"));
    fireEvent.click(view.getByTestId("read-all"));
    await waitFor(() => expect(device.closed).toEqual([{ tags: [key] }, { prefixes: ["ask:"] }]));
  });

  test("an answer closes the decision's notification here once the core took it", async () => {
    const source = new SyntheticSource();
    const closed: CloseMatch[] = [];
    const actions = new Actions(new Store(source), () => {}, globalThis, (match) => closed.push(match));
    actions.answer("d1", { kind: "item", id: "T2" }, "네, 오늘 해요");
    expect(closed).toEqual([]);
    actions.endToast();
    await waitFor(() => expect(closed).toEqual([{ prefixes: ["ask:T2:"] }]));
    actions.answer("d2", { kind: "card", id: "k-102" }, "그렇게 해요");
    actions.endToast();
    await waitFor(() => expect(closed).toEqual([{ prefixes: ["ask:T2:"] }, { tags: ["blocked:k-102"], prefixes: ["question:k-102:"] }]));
  });

  test("a notification chosen while the app is open takes the window to the item, as the bell does", async () => {
    const device = browser();
    await openBell(new SyntheticSource(), device.host, "#/due");
    for (const [request, hash] of [
      [{ kind: "ask", target: "T2", hash: "#/inbox" }, "#/inbox"],
      [{ kind: "reply", target: "T4", hash: "#/items/T4" }, "#/items/T4"],
      [{ kind: "reply", target: "G2", hash: "#/items/G2" }, "#/goals/G2"],
      [{ kind: "blocked", target: "k-101", hash: "#/cards/k-101" }, "#/cards/k-101"],
      [{ kind: "question", target: "k-102", hash: "#/cards/k-102" }, "#/cards/k-102"],
    ] as const) {
      await act(async () => device.open(request));
      expect(window.location.hash).toBe(hash);
    }
  });
});
