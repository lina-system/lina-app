import type { components as Board, paths as BoardPaths } from "./board.generated";
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

/** Request bodies of the owner's writes, as the lina#149 shapes comment gives them. */
export interface CommentRequest {
  readonly text: string;
  readonly answer?: boolean;
}

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
export type WriteRoute = "comments";

export function writePath(route: WriteRoute, id: string): string {
  return `${BOARD_BASE}/work/items/${encodeURIComponent(id)}/${route}`;
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
