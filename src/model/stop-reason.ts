import type { WorkState } from "../api/client";
import { reasonWord, W } from "../words";
import type { CardRow } from "./index";

/**
 * What a stopped row and its detail say after 중단됨, from one place (lina-app#142): the row's words of why and who it
 * waits on (CardRow.stop) when the model has them, else the reason's own word. `ask` is there only when the stop
 * waits on the owner: it names the field where the owner answers, in the detail. The time beside it is the row's
 * own (cardTime) on both.
 */
export function stopReason(card: { readonly state: WorkState; readonly reason?: string | null; readonly stop?: CardRow["stop"] }): { word: string; ask?: string } {
  if (card.state === "stopped" && card.stop) return card.stop.owner ? { word: card.stop.words, ask: W.answerField } : { word: card.stop.words };
  return { word: reasonWord(card.reason) ?? "" };
}
