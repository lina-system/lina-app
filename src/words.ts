/**
 * Every fixed string the screens show, in one place: the shared term table.
 * Components never hold their own screen text; they read it from here.
 */
import type { UsageRange, WorkState } from "./api/client";

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

/** A count in grouped digits, for tokens under 만. */
function grouped(count: number): string {
  return String(Math.round(count)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Tokens as `1.2만` or `3.4억` from ten thousand up, grouped digits under that. */
function tokenCount(count: number): string {
  const value = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  const scaled = (unit: number) => {
    const amount = Math.round((value / unit) * 10) / 10;
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
  };
  if (value >= 1e8) return `${scaled(1e8)}억`;
  if (value >= 1e4) return `${scaled(1e4)}만`;
  return grouped(value);
}

/** An estimated cost as `$3.42` under $100 and a whole `$128` from $100 up; `—` when OCX priced none of it. */
function costValue(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return NONE;
  const rounded = Math.round(usd * 100) / 100;
  return rounded >= 100 ? `$${Math.round(rounded)}` : `$${rounded.toFixed(2)}`;
}

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
  runnerWhy: {
    update: "업데이트 필요",
    prepare: "준비 필요",
    sign_in: "로그인 필요",
    unreachable: "연결 끊김",
    unknown: "확인 중",
  } as Readonly<Record<string, string>>,
  signedIn: "로그인됨",
  signIn: "로그인",
  signingIn: "로그인 중",
  deviceMissing: "기기를 찾을 수 없음",
  deviceBusy: "이미 진행 중",
  deviceUnsupported: "아직 지원하지 않음",
  deviceRefused: "기기가 거절함",
  restart: "다시 시작",
  restartOf: (name: string) => `${name} 다시 시작`,
  /** The row's restart control names what it restarts: the services on that node, the worker or the model link. */
  restartService: "서비스 다시 시작",
  restartServiceOf: (name: string) => `${name} 서비스 다시 시작`,
  /** Each status block counts what it lists: the nodes, then the owner's own Macs, which the nodes' count leaves out. */
  workDeviceHead: (all: number, ok: number, warn: number, down: number) => [`작업 기기 ${all}`, `정상 ${ok}`, warn ? `경고 ${warn}` : "", down ? `꺼짐 ${down}` : ""].filter(Boolean).join(SEP),
  personHead: (all: number, connected: number, offline: number) => [`내 기기 ${all}`, connected ? `연결됨 ${connected}` : "", offline ? `연결 끊김 ${offline}` : ""].filter(Boolean).join(SEP),
  /** A runner's update: the version the node has, then the fleet's. */
  versionGap: (installed: string, fleet: string) => `${installed} → ${fleet}`,
  checkMore: "자세히",
  restartWorker: "작업 실행기",
  restartOcx: "모델 연결",
  restartWorkerConfirm: "작업 실행기를 다시 시작합니다.",
  restartOcxConfirm: "모델 연결을 다시 시작합니다.",
  connected: "연결됨",
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
  quotaPaused: "일시 중지",
  quotaReauth: "다시 로그인 필요",
  quotaUnavailable: "사용 불가",
  quotaMissing: (service: string) => `${service}${SEP}계정 없음`,

  usage: "사용량",
  usageRange: { today: "오늘", "7d": "7일", "30d": "30일" } as Readonly<Record<UsageRange, string>>,
  usageByModel: "모델별",
  usageByMachine: "기기별",
  usageTotal: (cost: string, tokens: string) => `${cost}${SEP}토큰 ${tokens}`,
  usageLine: (name: string, cost: string, tokens: string) => `${name}${SEP}${cost}${SEP}토큰 ${tokens}`,
  cost: costValue,
  tokens: tokenCount,

  /** The model proxy's own row last in the quota list, never named: the models on, then only the links that are down. */
  ocxLine: (enabled: number, down: readonly string[]) => [`모델 ${enabled}개 켜짐`, ...(down.length ? [`연결 끊김: ${down.join(", ")}`] : [])].join(SEP),

  power: "전원",
  powerFresh: (ago: string) => `갱신 ${ago}`,
  powerWhy: { stopped: "감시 끊김", cloud: "클라우드 읽기 실패" } as Readonly<Record<string, string>>,
  powerMissing: "전원 기록 없음",
  powerBroken: "전원 기록 읽기 오류",
  powerCharge: { charging: "충전 중", on_battery: "배터리 사용", full: "완충", idle: "대기" } as Readonly<Record<string, string>>,
  powerIn: (watts: number) => `입력 ${Math.round(watts)}W`,
  powerOut: (watts: number) => `출력 ${Math.round(watts)}W`,
  temperature: (celsius: number) => `${Math.round(celsius)}°C`,
  powerRunsOut: (until: string) => `${until} 방전`,
  powerAlerts: (alerts: readonly string[]) => `경고: ${alerts.join(SEP)}`,
  powerAlert: {
    outage: "정전",
    temp: (name: string) => `${name} 온도`,
    offline: (name: string) => `${name} 연결 끊김`,
    cloud: "클라우드 읽기 실패",
    mqtt: (name: string) => `${name} 실시간 연결 끊김`,
    device: "전원 장비",
    other: "기타 경고",
  },
  hub: "허브",
  wallAdapter: (on: boolean) => (on ? "벽 전원 연결됨" : "벽 전원 끊김"),
  hubBattery: (percent: number) => `배터리 ${Math.round(percent)}%`,
  uplink: { wired: "유선", hotspot: "핫스팟" } as Readonly<Record<string, string>>,

  checks: "점검",
  checksEmpty: "점검 없음",
  checksOk: (n: number) => `정상 ${n}`,
  checkState: { failing: "실패", stale: "갱신 지연", error: "읽기 오류" } as Record<string, string>,

  fresh: (seconds: number) => `갱신 ${seconds}초 전`,
  live: "실시간",
  stale: "갱신 지연",
  offline: "연결 끊김",
  readFailed: (source: string) => `읽기 실패: ${source}`,
  loading: "불러오는 중",
  notFound: "찾을 수 없음",
  empty: "없음",

  commentField: "댓글 달기",
  send: "보내기",
  /** Why 보내기 cannot send yet, one line beside it (lina-app#142): the field is empty, or the last one is on its way. */
  sendWhyEmpty: "글 입력 대기",
  sendWhyBusy: "보내는 중",
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
  /** A row the core cannot describe: no checked title, no goal or card, no own name that may be drawn. */
  untitled: "제목 없음",
  /** The home's one grey line for the work nothing names (lina-app#124). */
  untitledCount: (n: number) => `제목 없는 ${n}건`,
  /** A lone stopped run whose only name is an internal one in Latin, never shown (lina-app#134). */
  unnamedRun: "이름 없는 실행",
  /** A stopped card with no title or goal left once its references go: whose it is (lina-app#148). */
  stoppedCardOf: (agent: string | null) => (agent ? `${agent}의 중단 카드` : "중단 카드"),
  /** A stopped row's words for who it waits on (lina-app#116). */
  needsCheck: "확인 필요",
  waitReview: "검토 대기",
  notRetried: "다시 시도 안 함",
  retryScheduled: "다시 시도 예정",
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

  talk: "대화",
  talkField: "메시지",
  replying: "답하는 중",
  carried: (agent: string) => (agent ? `${agent} 대화에 남음` : "대화에 남음"),
  talkBusy: "에이전트가 바쁨",
  talkDown: "에이전트 연결 안 됨",
  talkNoAgent: "맡은 에이전트 없음",
  talkTooLong: "글은 4000자까지",
  talkFailed: "답을 받지 못함",
  talkUnknownAgent: "없는 에이전트",
  talkRefusedKey: "에이전트가 연결을 거절함",
  /** The owner's own window on an agent is not its messenger chat (lina#482). */
  appWindow: "앱 대화 · 메신저 대화와 따로 남음",
  noTurns: "아직 나눈 대화 없음",
  historyFailed: "지난 대화를 읽지 못함",
  pickAgent: "에이전트를 고르면 대화가 열림",
  agentCard: "에이전트",
  cardGoals: (n: number) => `에이전트 · 목표 ${n}`,

  tabs: "탭",
  tabTalk: "대화",
  tabWork: "작업",
  tabStatus: "상태",
  today: "오늘",
  todayDecide: (n: number) => `결정 필요 ${n}`,
  todayRunning: (n: number) => `진행 중 ${n}`,
  todayDue: (n: number) => `오늘 마감 ${n}`,
  todayDone: (n: number) => `오늘 완료 ${n}`,

  bell: "알림",
  readAll: "모두 읽음",
  unread: (n: number) => `안 읽음 ${n}`,
  close: "닫기",
  quickAdd: "할 일 추가",
  markDone: (title: string) => `${title} 완료로 표시`,
  progress: (done: number, total: number) => `${done}/${total}`,
  runningCount: (n: number) => `진행 중 ${n}`,

  doneRecent: "최근 완료",
  doneOlder: "완료",
  doneSoFar: "완료된 것",
  round: (n: number) => `라운드 ${n}`,
  summariesStopped: "요약 중단됨",
  folded: "접힌 댓글",
  /** A run of comments with nothing left to read, one line (lina-app#149). */
  foldedRun: (n: number) => (n > 1 ? `접힌 댓글 ${n}건` : "접힌 댓글"),
  /** A card from a board the core only reads (lina#481): it is changed there, never here. */
  readOnly: "읽기 전용 · 칸반에서 변경",
  /** An old done card whose history the core does not keep (`detail: false`). */
  noHistory: "기록 보관 안 됨",
  noStart: "시작 기록 없음",
  runStarted: "작업 시작",
  untitledRun: "제목 없음",
  latest: (time: string) => `최근 활동 ${time}`,
  allAgents: "전체",
  todoProgress: (done: number, total: number) => `할 일 ${done}/${total}`,
  took: (time: string) => `소요 ${time}`,
  record: "기록",
  toolSteps: (n: number) => `도구 사용 ${n}번`,
  repeated: (n: number) => `×${n}`,
  result: "결과",
  outcome: { accepted: "검토 통과", rejected: "검토 필요", stopped: "중단됨", ended: "완료", unknown: "완료 기록 없음", going: "진행 중" },
  yesterday: "어제",

  pushRow: "알림 받기",
  pushNotSetUp: "푸시 설정 안 됨",
  pushAddToHome: "공유 › 홈 화면에 추가 후 켤 수 있음",
  pushUnsupported: "이 브라우저는 받을 수 없음",
  pushBlocked: "브라우저에서 알림 차단됨",
  pushUnknown: "알림 설정을 읽지 못함",
  pushOnFailed: "켜지 못함",
  pushOffFailed: "끄지 못함",

  settings: "설정",
  settingsReadOnly: "이 기기에서는 볼 수만 있습니다",
  settingsStale: "다른 곳에서 먼저 바뀌었습니다 · 새로 읽었습니다",
  more: (n: number) => `외 ${n}개`,
  defaults: "기본값",
  defaultValue: "기본값",
  defaultRunner: "기본 실행기",
  fallbackModel: "대체 모델",
  followDefault: "기본값 따름",
  runners: "실행기",
  /** A runner as the screens name it: its place in the runner list, never its key in the settings. */
  runnerNumber: (n: number) => `실행기 ${n}`,
  turnOn: "켜기",
  turnedOn: "켬",
  turnedOff: "끔",
  model: "모델",
  effort: "생각 깊이",
  effortWord: { none: "없음", minimal: "최소", low: "낮음", medium: "보통", high: "높음", xhigh: "매우 높음" } as Readonly<Record<string, string>>,
  access: "접근 권한",
  accessWord: { "read-only": "읽기만", "workspace-write": "작업 폴더 쓰기", full: "전체" } as Readonly<Record<string, string>>,
  command: "명령",
  rules: "배정 규칙",
  ruleOther: "그 외",
  ruleTo: (label: string, runner: string) => `${label} → ${runner}`,
  edit: "편집",
  editDone: "완료",
  ruleAdd: "규칙 추가",
  ruleLabel: "라벨",
  ruleSize: "크기",
  add: "추가",
  remove: (what: string) => `${what} 삭제`,
  moveUp: (what: string) => `${what} 위로`,
  moveDown: (what: string) => `${what} 아래로`,
  workDevices: "작업 기기",
  fileDevices: "파일 기기",
  myDevices: "내 기기",
  bid: "입찰",
  named: "지정",
  caps: (bid: number, named: number) => `입찰 ${bid} · 지정 ${named}`,
  namedCaps: (named: number) => `지정 ${named}`,
  statusOnly: "상태만 봅니다",
  bidCap: "동시 작업 (입찰)",
  namedCap: "동시 작업 (지정)",
  fewer: (what: string) => `${what} 줄이기`,
  moreOf: (what: string) => `${what} 늘리기`,
  repoWork: "저장소 작업",
  fastDevice: "빠른 기기",
  modelsOcx: "모델",
  modelsOn: (n: number) => `켜진 모델 ${n}개`,
  modelsFoot: "앱에서는 모델을 켜고 끌 수 없음",
  quotaLeft: (left: number, reset: string | null) => [`남은 양 ${Math.round(left)}%`, reset].filter(Boolean).join(SEP),
  usedUp: "다 씀",
  quotaUnknown: "확인 못 함",
  ocxDown: (time: string) => `모델 상태 읽기 실패 · ${time} 기준`,
  asOf: (time: string) => `${time} 기준`,
  noAccount: "계정 없음",
  history: "기록",
  allHistory: "모든 기록",
  byKind: { app: "앱", cli: "CLI", outside: "바깥 편집", rollback: "되돌리기" } as Readonly<Record<string, string>>,
  noChange: "바뀐 것 없음",
  added: (what: string) => `${what} 추가`,
  rule: (name: string) => `${name} 규칙`,
  ruleOrder: "배정 규칙 순서",
  alias: (name: string) => `${name} 별칭`,
  modeDefault: (mode: string) => `${mode} 기본`,
  rollbackOne: "한 단계 되돌리기",
  rollbackQuestion: "이전 설정으로 되돌립니다. 되돌리기도 기록에 남습니다.",
  rollbackConfirm: "이전 설정으로 되돌리기",
};

/**
 * A push notification's first body line, by the kind of item it is about (push-client.yaml ShowMessage.kind).
 * public/sw.js keeps a copy; src/sw.test.ts holds the two equal.
 */
export const PUSH_LINE = { ask: "결정 필요", reply: "답글", blocked: "중단됨 · 피드백 대기", question: "중단됨 · 피드백 대기" } as const;

/** The kind word beside a work card's icon in its detail. */
export const KIND_WORD = { code: "코드", docs: "문서", research: "조사", device: "기기" } as const;

/** What a card is called when the core has no checked title for it: its kind of work, never its raw title. */
export const KIND_TITLE = { code: "코드 작업", docs: "문서 작업", research: "조사", device: "기기 작업" } as const;

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

/** The one reason word in a runner cell. A reason the table does not know yet reads as 확인 중. */
export function runnerReason(why: string | null | undefined): string {
  return why && Object.hasOwn(W.runnerWhy, why) ? W.runnerWhy[why] : W.runnerWhy.unknown;
}

/** Why a node shows no CPU, memory or disk reading, from the core's `metricsWhy` (lina-app#144). */
export const METRICS_WHY: Readonly<Record<string, string>> = {
  no_source: "측정 원본 없음",
  unknown: "측정 기록 없음",
  down: "기기 응답 없음",
};

/** One reason for missing readings. A value the table does not know, or none, reads by whether the node answered. */
export function metricsReason(why: string | null | undefined, reachable: boolean): string {
  if (why && Object.hasOwn(METRICS_WHY, why)) return METRICS_WHY[why];
  return reachable ? METRICS_WHY.unknown : METRICS_WHY.down;
}

/** The version number in what a node reports installed (`omo 5.1.51 (engine: …)` reads `5.1.51`), or null. */
export function versionOf(installed: string | null | undefined): string | null {
  if (!installed) return null;
  return /\d+(?:\.\d+)+(?:-[0-9A-Za-z.]+)?/.exec(installed)?.[0] ?? null;
}

export type CheckOutcome = "ok" | "hold" | "fail";

/** A check whose own line is not Korean reads one of these, by the check's id and the line's ok/hold/fail. */
export const CHECK_LINE: Readonly<Record<string, Readonly<Record<CheckOutcome, string>>>> = {
  "runner-sync": { ok: "실행기 업데이트 완료", hold: "실행기 업데이트 보류", fail: "실행기 업데이트 실패" },
};

/** The line for a check the table does not know. */
export const CHECK_OUTCOME_LINE: Readonly<Record<CheckOutcome, string>> = { ok: "점검 정상", hold: "점검 보류", fail: "점검 실패" };

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
  usage: "사용량",
  modelsState: "모델",
  checks: "점검",
  settings: "설정",
  settingsHistory: "설정 기록",
  settingsModels: "모델",
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

export const BANNED_WORDS = ["세션", "일꾼", "회차", "판정", "장부", "준 기다림", "멈춤", "막힘", "끝남", "끝난", "샌 것", "심박", "분째", "시간째", "일째", "작업 마침", "소식이 끊김", "오래됨", "검토 반려", "OCX"];
