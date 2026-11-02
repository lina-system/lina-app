import { expect, test } from "vitest";
import { createClient } from "./client";
import { syntheticHome, syntheticNotifications, syntheticStatus } from "../fixtures/synthetic";

test("reads home, notifications and status through the generated paths", async () => {
  const seen: string[] = [];
  const bodies: Record<string, unknown> = {
    "/api/home": syntheticHome,
    "/api/notifications": syntheticNotifications,
    "/api/status": syntheticStatus,
  };
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    const body = bodies[url.pathname];
    if (!body) throw new Error(`unexpected ${url.pathname}`);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = createClient("http://core.test", fetchImpl);
  const home = await client.getHome();
  const notifications = await client.getNotifications();
  const status = await client.getStatus();

  expect(seen).toEqual(["/api/home", "/api/notifications", "/api/status"]);
  expect(home.summary.goalCount).toBe(2);
  expect(notifications.unreadCount).toBe(1);
  expect(status.machines[0]?.state).toBe("up");
  expect(status.quota[0]?.remaining).toBe(40);
});
