import type { components, paths } from "./generated";

export type Home = components["schemas"]["Home"];
export type WorkState = components["schemas"]["WorkState"];
export type NotificationList = components["schemas"]["NotificationList"];
export type Status = components["schemas"]["Status"];

type GetPath = {
  [P in keyof paths]: paths[P] extends { get: unknown } ? P : never;
}[keyof paths];

type JsonBody<P extends GetPath> = paths[P] extends {
  get: { responses: { 200: { content: { "application/json": infer Body } } } };
}
  ? Body
  : never;

export async function getJson<P extends GetPath>(
  path: P,
  fetchImpl: typeof fetch = fetch,
  baseUrl = "",
): Promise<JsonBody<P>> {
  const url = baseUrl ? new URL(path, baseUrl).toString() : path;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}`);
  }
  return (await response.json()) as JsonBody<P>;
}

export function createClient(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  return {
    getHome: () => getJson("/api/home", fetchImpl, baseUrl),
    getNotifications: () => getJson("/api/notifications", fetchImpl, baseUrl),
    getStatus: () => getJson("/api/status", fetchImpl, baseUrl),
  };
}
