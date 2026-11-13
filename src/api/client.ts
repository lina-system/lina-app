import type { components as Board, paths as BoardPaths } from "./board.generated";
import type { components as Push } from "./push.generated";
import type { components as SettingsApi, paths as SettingsPaths } from "./settings.generated";
import type { components as Talk, paths as TalkPaths } from "./talk.generated";
import type { components as Work, paths as WorkPaths } from "./work.generated";

export type WorkState = Board["schemas"]["WorkState"];
export type BoardSnapshot = Board["schemas"]["BoardSnapshot"];
export type RunCard = Board["schemas"]["RunCard"];
export type DecideRow = Board["schemas"]["DecideRow"];
export type MineRow = Board["schemas"]["MineRow"];
export type ItemRow = Board["schemas"]["ItemRow"];
export type Notice = Board["schemas"]["Notice"];
export type Machine = Board["schemas"]["Machine"];
export type QuotaService = Board["schemas"]["QuotaService"];
export type QuotaAccount = Board["schemas"]["QuotaAccount"];
export type SourceError = Board["schemas"]["SourceError"];
export type DevicesView = Board["schemas"]["DevicesView"];
export type DeviceAction = Board["schemas"]["DeviceAction"];
export type PersonDevice = Board["schemas"]["PersonDevice"];
/** The hub's power equipment, read only (lina#483): present only when the core watches it. */
export type PowerView = Board["schemas"]["PowerView"];
export type PowerStation = Board["schemas"]["PowerStation"];
export type RunnerCell = Board["schemas"]["RunnerCell"];
export type QuotaView = Board["schemas"]["QuotaView"];
/** Tokens and estimated cost per model, provider, account and machine, for one range (lina#232). */
export type UsageView = Board["schemas"]["UsageView"];
export type UsageRow = Board["schemas"]["UsageRow"];
/** The models on, and whether each machine's OCX link answered recently (lina#232). */
export type ModelsState = Board["schemas"]["ModelsState"];
export type LinkState = Board["schemas"]["LinkState"];
/** The ranges the usage route serves, in the order the screen offers them; the screen reads every one of them. */
export type UsageRange = UsageView["range"];
export const USAGE_RANGES: readonly UsageRange[] = ["today", "7d", "30d"];
/** The hub's own health checks (lina#233). */
export type StatusCheck = Board["schemas"]["StatusCheck"];
export type StatusChecks = Board["schemas"]["StatusChecks"];
export type Person = Board["schemas"]["Person"];
export type ItemList = Board["schemas"]["ItemList"];
export type ItemSummary = Board["schemas"]["ItemSummary"];
export type ItemDetail = Board["schemas"]["ItemDetail"];
export type ItemComment = Board["schemas"]["ItemComment"];
export type ItemRun = Board["schemas"]["ItemRun"];
export type ActionResult = Board["schemas"]["ActionResult"];
/** The change stream (lina#150): what changed, by source and id, with no body; the screens refetch the snapshot. */
export type ChangeEvent = Board["schemas"]["ChangeEvent"];
/** One worker run's own record, round by round (lina#201). */
export type RunRecord = Board["schemas"]["RunRecord"];
export type RecordRound = Board["schemas"]["RecordRound"];
export type RecordRow = Board["schemas"]["RecordRow"];
export type ChangeBatch = Board["schemas"]["ChangeBatch"];
export type ChangeResync = Board["schemas"]["ChangeResync"];
export type ChangeMessage = Board["schemas"]["ChangeMessage"];

/** The core's own one-line refusal (4xx): `{detail}`. */
export type Refusal = Board["schemas"]["Refusal"];

type JsonBody<T> = T extends { requestBody?: { content: { "application/json": infer Body } } } ? Body : never;

/** Request bodies of the owner's writes, from the core's schema. */
export type CommentRequest = JsonBody<BoardPaths["/work/items/{id}/comments"]["post"]>;
export type DoneRequest = JsonBody<BoardPaths["/work/items/{id}/done"]["post"]>;
/** work-client's AnswerRequest; `author` has a default (owner), so the app sends text only. */
export interface AnswerRequest {
  readonly text: string;
}
export type AnswerResult = Work["schemas"]["AnswerResult"];
export type NoticesReadResult = Board["schemas"]["ReadResult"];
/** The core takes exactly one of the two: the notices chosen (at least one), or all of them. */
export type NoticesReadRequest = JsonBody<BoardPaths["/notices/read"]["post"]> & ({ keys: string[]; all?: never } | { all: true; keys?: never });

export type GoalList = Work["schemas"]["GoalList"];
export type WorkGoal = Work["schemas"]["WorkGoal"];
export type WorkCardList = Work["schemas"]["WorkCardList"];
export type WorkCardSummary = Work["schemas"]["WorkCardSummary"];
export type WorkCardDetail = Work["schemas"]["WorkCardDetail"];
export type WorkInbox = Work["schemas"]["Inbox"];

/** The work settings (settings-client.yaml, lina#256): the keys, their revisions, rollback and OCX's models. */
export type Settings = SettingsApi["schemas"]["Settings"];
export type SettingsView = SettingsApi["schemas"]["SettingsView"];
export type SettingsDevice = SettingsApi["schemas"]["Device"];
export type SettingsRunner = SettingsApi["schemas"]["Runner"];
export type SettingsRule = SettingsApi["schemas"]["Rule"];
export type SettingsRevision = SettingsApi["schemas"]["Revision"];
export type SettingsHistory = SettingsApi["schemas"]["HistoryView"];
export type SettingsAuditLine = SettingsApi["schemas"]["AuditLine"];
export type SettingsChange = SettingsApi["schemas"]["Change"];
export type SettingsModels = SettingsApi["schemas"]["ModelsView"];
export type SettingsModel = SettingsApi["schemas"]["Model"];
export type SettingsModelCheck = SettingsApi["schemas"]["ModelCheck"];
export type SettingsWritten = SettingsApi["schemas"]["WriteResult"];
export type SettingsInvalid = SettingsApi["schemas"]["ValidationError"];
export type SettingsChangeEvent = SettingsApi["schemas"]["SettingsChangeEvent"];
/** A JSON Merge Patch (RFC 7396) of the settings: null removes a key, an array replaces the one there. */
export type SettingsPatch = { readonly [key: string]: unknown };

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer Body } } } } ? Body : never;

export type Routes = {
  board: Json<BoardPaths["/board"]["get"]>;
  items: Json<BoardPaths["/work/items"]["get"]>;
  item: Json<BoardPaths["/work/items/{id}"]["get"]>;
  devices: Json<BoardPaths["/devices"]["get"]>;
  quota: Json<BoardPaths["/quota"]["get"]>;
  /** Usage for one range: the route's id is the range (see routePath). */
  usage: Json<BoardPaths["/usage"]["get"]>;
  modelsState: Json<BoardPaths["/models/state"]["get"]>;
  checks: Json<BoardPaths["/status/checks"]["get"]>;
  goals: Json<WorkPaths["/work/goals"]["get"]>;
  goal: Json<WorkPaths["/work/goals/{id}"]["get"]>;
  cards: Json<WorkPaths["/work/cards"]["get"]>;
  card: Json<WorkPaths["/work/cards/{id}"]["get"]>;
  inbox: Json<WorkPaths["/work/inbox"]["get"]>;
  record: Json<BoardPaths["/work/runs/{id}/record"]["get"]>;
  settings: Json<SettingsPaths["/work/settings"]["get"]>;
  /** The audit lines, newest first: the route's id is the `limit` (see routePath). */
  settingsHistory: Json<SettingsPaths["/work/settings/history"]["get"]>;
  settingsModels: Json<SettingsPaths["/work/settings/models"]["get"]>;
};

export type RouteName = keyof Routes;

export const BOARD_BASE = "/api/lina";
export const WORK_BASE = "/api/plugins/kanban";

/** The owner's write routes (lina#149); each answers ActionResult or 4xx {detail}. */
export type WriteRoute = "comments" | "done" | "undo" | "retry";

export function writePath(route: WriteRoute, id: string): string {
  return `${BOARD_BASE}/work/items/${encodeURIComponent(id)}/${route}`;
}

/**
 * The owner writes a to-do for themself (lina#693): POST `{text, due}` answers the new row in the shape of the
 * `/work/items` rows, or 4xx {detail} like the other writes. The contract copy has no route yet, so the body is here.
 */
export const ADD_ITEM_PATH = `${BOARD_BASE}/work/items`;
export type AddItemRequest = { text: string; due: string | null };

export const NOTICES_READ_PATH = `${BOARD_BASE}/notices/read`;

/** The settings' own address: GET reads them with their ETag, PATCH changes them with it as If-Match. */
export const SETTINGS_PATH = `${BOARD_BASE}/work/settings`;
export const SETTINGS_ROLLBACK_PATH = `${BOARD_BASE}/work/settings/rollback`;

/** The history the settings screen reads: the last few on the screen, every kept line on its own page. */
export const SETTINGS_HISTORY = { recent: "5", all: "500" } as const;

/** The change stream's WebSocket; the credential goes as `?token=`, like the dashboard's other sockets. */
export const EVENTS_PATH = `${BOARD_BASE}/events`;

/** One turn with the agent that owns a goal or to-do (talk-client.yaml); the reply streams as server-sent events. */
export type TalkRequest = JsonBody<TalkPaths["/work/items/{item_id}/talk"]["post"]>;
export type TalkEvent = Talk["schemas"]["TalkEvent"];
export type TalkError = Talk["schemas"]["Error"];
/** The owner's own window on one agent (lina#482): its turns stream like a to-do's, with no item and nothing carried. */
export type AgentTalkEvent = Talk["schemas"]["AgentTalkEvent"];
/** The earlier turns of that window, oldest first; `session_id` is null before the first turn. */
export type AgentTalkHistory = Talk["schemas"]["AgentTalkHistory"];

/** Web Push to the owner's devices (push-client.yaml, lina#244). */
export type PushKey = Push["schemas"]["PushKey"];
export type PushSubscriptionRequest = Push["schemas"]["SubscriptionRequest"];
export type PushSubscriptionResult = Push["schemas"]["SubscriptionResult"];
export type PushRemoveRequest = Push["schemas"]["RemoveRequest"];
export type PushRemoveResult = Push["schemas"]["RemoveResult"];
/** What the service worker receives: show a notification for an item, or close the one with that tag. */
export type PushMessage = Push["schemas"]["PushMessage"];
export type PushShowMessage = Push["schemas"]["ShowMessage"];

export const PUSH_KEY_PATH = `${BOARD_BASE}/push/key`;
export const PUSH_SUBSCRIPTIONS_PATH = `${BOARD_BASE}/push/subscriptions`;
export const PUSH_REMOVE_PATH = `${BOARD_BASE}/push/subscriptions/remove`;

export function talkPath(itemId: string): string {
  return `${BOARD_BASE}/work/items/${encodeURIComponent(itemId)}/talk`;
}

/** The owner's window on one agent: POST runs a turn, GET reads the earlier turns. */
export function agentTalkPath(agent: string): string {
  return `${BOARD_BASE}/agents/${encodeURIComponent(agent)}/talk`;
}

/** A question a work card asks is answered on the work API (work-client.yaml). */
export function cardAnswerPath(cardId: string): string {
  return `${WORK_BASE}/work/inbox/${encodeURIComponent(cardId)}/answer`;
}

export function routePath(name: RouteName, id?: string): string {
  const enc = id === undefined ? "" : encodeURIComponent(id);
  switch (name) {
    case "board":
      return `${BOARD_BASE}/board`;
    case "items":
      return `${BOARD_BASE}/work/items`;
    case "item":
      return `${BOARD_BASE}/work/items/${enc}`;
    case "devices":
      return `${BOARD_BASE}/devices`;
    case "quota":
      return `${BOARD_BASE}/quota`;
    case "usage":
      // The route's id is the range (`today`, `7d`, `30d`), the query the core reads.
      return `${BOARD_BASE}/usage?range=${encodeURIComponent(id ?? "today")}`;
    case "modelsState":
      return `${BOARD_BASE}/models/state`;
    case "checks":
      return `${BOARD_BASE}/status/checks`;
    case "goals":
      return `${WORK_BASE}/work/goals`;
    case "goal":
      return `${WORK_BASE}/work/goals/${enc}`;
    case "cards":
      return `${WORK_BASE}/work/cards`;
    case "card":
      return `${WORK_BASE}/work/cards/${enc}`;
    case "inbox":
      return `${WORK_BASE}/work/inbox`;
    case "record":
      return `${BOARD_BASE}/work/runs/${enc}/record`;
    case "settings":
      return SETTINGS_PATH;
    case "settingsHistory":
      return `${SETTINGS_PATH}/history?limit=${encodeURIComponent(id ?? SETTINGS_HISTORY.recent)}`;
    case "settingsModels":
      return `${SETTINGS_PATH}/models`;
  }
}
