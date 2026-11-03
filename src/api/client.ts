import type { components as Board, paths as BoardPaths } from "./board.generated";
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
export type QuotaView = Board["schemas"]["QuotaView"];
export type Person = Board["schemas"]["Person"];
export type ItemList = Board["schemas"]["ItemList"];
export type ItemSummary = Board["schemas"]["ItemSummary"];
export type ItemDetail = Board["schemas"]["ItemDetail"];
export type ItemComment = Board["schemas"]["ItemComment"];
export type ItemRun = Board["schemas"]["ItemRun"];
export type ActionResult = Board["schemas"]["ActionResult"];
/** The change stream (lina#150): what changed, by source and id, with no body; the screens refetch the snapshot. */
export type ChangeEvent = Board["schemas"]["ChangeEvent"];
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

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer Body } } } } ? Body : never;

export type Routes = {
  board: Json<BoardPaths["/board"]["get"]>;
  items: Json<BoardPaths["/work/items"]["get"]>;
  item: Json<BoardPaths["/work/items/{id}"]["get"]>;
  devices: Json<BoardPaths["/devices"]["get"]>;
  quota: Json<BoardPaths["/quota"]["get"]>;
  goals: Json<WorkPaths["/work/goals"]["get"]>;
  goal: Json<WorkPaths["/work/goals/{id}"]["get"]>;
  cards: Json<WorkPaths["/work/cards"]["get"]>;
  card: Json<WorkPaths["/work/cards/{id}"]["get"]>;
  inbox: Json<WorkPaths["/work/inbox"]["get"]>;
};

export type RouteName = keyof Routes;

export const BOARD_BASE = "/api/lina";
export const WORK_BASE = "/api/plugins/kanban";

/** The owner's write routes (lina#149); each answers ActionResult or 4xx {detail}. */
export type WriteRoute = "comments" | "done" | "undo" | "retry";

export function writePath(route: WriteRoute, id: string): string {
  return `${BOARD_BASE}/work/items/${encodeURIComponent(id)}/${route}`;
}

export const NOTICES_READ_PATH = `${BOARD_BASE}/notices/read`;

/** The change stream's WebSocket; the credential goes as `?token=`, like the dashboard's other sockets. */
export const EVENTS_PATH = `${BOARD_BASE}/events`;

/** One turn with the agent that owns a goal or to-do (talk-client.yaml); the reply streams as server-sent events. */
export type TalkRequest = JsonBody<TalkPaths["/work/items/{item_id}/talk"]["post"]>;
export type TalkEvent = Talk["schemas"]["TalkEvent"];
export type TalkError = Talk["schemas"]["Error"];

export function talkPath(itemId: string): string {
  return `${BOARD_BASE}/work/items/${encodeURIComponent(itemId)}/talk`;
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
  }
}
