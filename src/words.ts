/**
 * Every fixed string the screens show, in one place: the shared term table.
 * Components never hold their own screen text; they read it from here.
 */
import type { WorkState } from "./api/client";

export const STATE_WORD: Record<WorkState, string> = {
  planned: "예정",
  in_progress: "진행 중",
  waiting: "대기",
  stopped: "중단됨",
  done: "완료",
};

/** API reason codes that read as one word after the state. Other codes (gate, budget, cancelled, unknown) show none. */
export const REASON_WORD: Readonly<Record<string, string>> = {
  decision: "결정 필요",
  feedback: "피드백",
  review: "검토 필요",
  hold: "보류",
  blocked_by_item: "진행 대기",
  no_response: "응답 없음",
  unresponsive: "응답 없음",
  failed: "실패",
  rejected: "실패",
  result_missing: "결과 누락",
};

export const STATE_WORDS = Object.values(STATE_WORD);
export const REASON_WORDS = [...new Set(Object.values(REASON_WORD))];

export function reasonWord(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return Object.hasOwn(REASON_WORD, reason) ? REASON_WORD[reason] : null;
}

export function stateLabel(state: WorkState, reason?: string | null): string {
  const word = reasonWord(reason);
  return word ? `${STATE_WORD[state]} · ${word}` : STATE_WORD[state];
}

export const SEP = " · ";
const NONE = "—";
export const CRUMB = " › ";

export const W = {
  app: "LINA",
  inbox: "수신함",
  running: "진행 중인 작업",
  due: "마감일",
  done: "완료",
  agents: "에이전트",
  goals: "목표",
  status: "기기·쿼터",
  back: "뒤로",
  sidebar: "메뉴",

  decide: "결정 필요",
  review: "검토 필요",
  mine: "내 할 일",
  ask: "질문",
  act: "요청",

  dueOverdue: "지남",
  dueToday: "오늘",
  dueWeek: "이번 주",
  dueLater: "이후",

  agentRunning: "진행 중",
  agentReview: "검토 필요",
  agentGoals: "목표",
  doneToday: (n: number) => `완료 · 오늘 ${n}`,

  doneCondition: "완료 조건",
  ownerWords: "내 말",
  todos: "할 일",
  cards: "작업",
  workerRuns: "실행",
  runs: "실행",
  comments: "댓글",
  evidence: "완료 근거",
  now: "지금",
  todo: "할 일",

  devices: "기기",
  quota: "쿼터",
  deviceLine: (all: number, ok: number, warn: number, down: number) => ({ all: `기기 ${all}`, ok: `정상 ${ok}`, warn: `경고 ${warn}`, down: `꺼짐 ${down}` }),
  stoppedCount: (n: number) => `중단됨 ${n}`,
  machineState: { ok: "정상", warn: "경고", down: "꺼짐" } as Record<string, string>,
  load: (running: number | null, cap: number) => `작업 ${running ?? NONE}/${cap}`,
  cpu: "CPU",
  memory: "메모리",
  disk: "디스크",
  meter: (label: string, n: number | null) => `${label} ${n === null ? NONE : `${Math.round(n)}%`}`,
  none: NONE,
  percent: (n: number) => `${Math.round(n)}%`,
  ratePerHour: (n: number) => `시간당 +${Math.round(n)}%`,
  rateTitle: "최근 5시간 평균",
  quotaWarn: "주의",
  quotaAccount: (n: number) => `계정 ${n}`,
  quotaPaused: "일시 정지",
  quotaUnavailable: "사용 불가",

  fresh: (seconds: number) => `갱신 ${seconds}초 전`,
  stale: "갱신 지연",
  offline: "연결 끊김",
  readFailed: (source: string) => `읽기 실패: ${source}`,
  loading: "불러오는 중",
  notFound: "찾을 수 없음",
  empty: "없음",

  commentField: "댓글 달기",
  send: "보내기",
  sentTo: (agent: string) => `${agent}에게 보냄`,
  justNow: "방금",
  resolved: "해결됨",
  writeFailed: "보내지 못함",

  answerField: "답 달기",
  recommended: "추천",
  waitingOn: (titles: string) => `진행 대기: ${titles}`,
  answered: "답함",
  markedDone: "완료로 표시함",
  undo: "되돌리기",
  isDone: (title: string) => `${title} 완료됨`,
  withOpenQuestion: (n: number) => `열린 할 일 ${n}개도 함께 완료할까요?`,
  withOpen: "함께 완료",
  cancel: "취소",
  retry: "다시 시도",
  retryText: "다시 시도해 주세요.",
  requestedTo: (agent: string) => `${agent}에게 요청함`,
  errOpenTodos: "열린 할 일 있음",
  errUndoExpired: "10분 지나 되돌릴 수 없음",
  errNotOwnersMark: "되돌릴 완료 표시 없음",
  errNoDecision: "열린 결정 없음",
  errClosed: "이미 닫힌 항목",
  errNoText: "글 없음",
  errTextLength: "글은 2000자까지",
  errTooMany: "쓰기가 너무 많음",

  bell: "알림",
  readAll: "모두 읽음",
  unread: (n: number) => `안 읽음 ${n}`,
  close: "닫기",
  quickAdd: "할 일 추가",
  markDone: (title: string) => `${title} 완료로 표시`,
  progress: (done: number, total: number) => `${done}/${total}`,
  runningCount: (n: number) => `진행 중 ${n}`,
};

/** The one reason word after a machine's state, from the core's `why`. `down` is the state itself and shows none. */
export const MACHINE_WHY: Readonly<Record<string, string>> = {
  unreachable: "연결 끊김",
  disk: "디스크",
  memory: "메모리",
  cpu: "CPU",
  temp: "온도",
  runner: "실행기",
  service: "실행기",
  over: "작업 초과",
  quiet: "응답 없음",
  pending: "응답 없음",
};

export function machineWhy(why: string | null | undefined): string | null {
  return why && Object.hasOwn(MACHINE_WHY, why) ? MACHINE_WHY[why] : null;
}

/** Display names for the services the core knows; any other service shows as the core gives it. */
export const SERVICE_NAME: Readonly<Record<string, string>> = {
  anthropic: "Claude",
  openai: "ChatGPT",
  google: "Gemini",
  xai: "Grok",
};

export function serviceName(service: string): string {
  return Object.hasOwn(SERVICE_NAME, service) ? SERVICE_NAME[service] : service;
}

export const SOURCE_WORD: Readonly<Record<string, string>> = {
  work: "할 일",
  worker: "작업",
  devices: "기기",
  metrics: "기기 상태",
  quota: "쿼터",
  board: "현황",
  items: "목표",
  goals: "목표",
  cards: "작업",
  inbox: "수신함",
  detail: "상세",
};

export const REPLY_RESULT: Readonly<Record<string, string>> = {
  applied: "반영함",
  needs_answer: "답변 필요",
  not_applied: "반영 안 함",
};

export const BANNED_WORDS = ["세션", "일꾼", "회차", "판정", "장부"];
