import type { Report, ReportSummary } from "../api/client";

/**
 * Synthetic reports for the viewer (lina-app#50, #83, #114): made-up words and numbers, generated images, no real
 * report text. `&reports=demo` puts them in the scene, links the long one to k-101 and goal G1, and has the first agent
 * send reference lines for them in its window. The images are SVG drawn here, served as the report's own images 0-2.
 */
export const REPORT_IDS = { long: "rep_5e1f0a7c2b90", legacy: "rep_0b5d3c6e8a14", broken: "rep_9c2e7f41d6a3", nested: "rep_3a7c0e5f9b21", slow: "rep_6c1e8d3f5a27", negative: "rep_7d4b2e9a1c06" } as const;

/** How late the synthetic core answers the slow report's first image (rep_6c1e8d3f5a27, images/0). */
export const SLOW_IMAGE_MS = 2500;

/** The page address a reference line carries: the core's `/reports/<id>/page` on a host that resolves nowhere. */
export function pageOf(id: string): string {
  return `https://hub.invalid/reports/${id}/page`;
}

export interface SceneReport {
  readonly summary: Omit<ReportSummary, "title" | "summary" | "version" | "updatedAt">;
  /** Every version, oldest first: its number, time, title, line and body. */
  readonly versions: { version: number; at: number; title: string; summary: string; body: string }[];
  /**
   * How many times its images were replaced without a new version: a Desk sync that changes only the image files
   * sends the `reports` event and leaves the report's version, time and body as they were (hermes_cli/desk_reports.py).
   */
  imageRevision?: number;
}

const MIN = 60;
const HOUR = 3600;

/** A report as GET /reports/{id} serves it: the newest version, or the one asked for; null for a version it lacks. */
export function reportOf(report: SceneReport, version?: number): Report | null {
  const newest = report.versions[report.versions.length - 1];
  const shown = version === undefined ? newest : report.versions.find((each) => each.version === version);
  if (!shown) return null;
  return {
    ...report.summary,
    title: shown.title,
    summary: shown.summary,
    version: newest.version,
    updatedAt: newest.at,
    body: shown.body,
    shownVersion: shown.version,
    versions: report.versions.map(({ version: n, at, title, summary }) => ({ version: n, at, title, summary })),
  };
}

export function summaryOf(report: SceneReport): ReportSummary {
  const newest = report.versions[report.versions.length - 1];
  return { ...report.summary, title: newest.title, summary: newest.summary, version: newest.version, updatedAt: newest.at };
}

const IMAGE_SHAPES = [
  { width: 1600, height: 700, hue: 212, word: "가상 화면 1 · 변경 목록" },
  { width: 900, height: 640, hue: 152, word: "가상 화면 2 · 요약 칸" },
  { width: 900, height: 640, hue: 28, word: "가상 화면 3 · 확인 표" },
] as const;

/** One of the long report's three images: a generated SVG with a word on it, as a data address; a replaced one says so. */
export function reportImageData(position: number, revision = 0): string | null {
  const shape = IMAGE_SHAPES[position];
  if (!shape) return null;
  const { width, height } = shape;
  const hue = (shape.hue + revision * 120) % 360;
  const word = revision ? `${shape.word} · 교체 ${revision}` : shape.word;
  const rows = Array.from({ length: 6 }, (_, index) => `<rect x="${width * 0.08}" y="${height * (0.32 + index * 0.1)}" width="${width * (0.84 - index * 0.09)}" height="${height * 0.05}" rx="8" fill="hsl(${hue} 60% ${70 - index * 4}%)"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="hsl(${hue} 45% 94%)"/><rect x="${width * 0.04}" y="${height * 0.06}" width="${width * 0.92}" height="${height * 0.88}" rx="24" fill="#ffffff" stroke="hsl(${hue} 40% 70%)" stroke-width="4"/><text x="${width * 0.08}" y="${height * 0.22}" font-family="sans-serif" font-size="${Math.round(height * 0.075)}" fill="hsl(${hue} 50% 30%)">${word}</text>${rows}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const WIDE_TABLE = [
  "| 묶음 | 변경 | 추가 줄 | 지운 줄 | 검토 | 시험 | 걸린 시간 | 비율 |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ...Array.from({ length: 14 }, (_, index) => {
    const added = 120 + ((index * 937) % 880);
    const removed = 40 + ((index * 431) % 300);
    return `| 가상 묶음 ${index + 1} | 화면 문구 정리 ${index + 1} | ${added.toLocaleString("en-US")} | ${removed} | ${index % 3 ? "통과" : "대기"} | ${80 + (index % 20)} | ${(1.5 + index * 0.25).toFixed(2)}시간 | ${(index * 7) % 100}% |`;
  }),
].join("\n");

function longBody(edits: number): string {
  return [
    "이번 주 가상 릴리스의 변경을 모아 정리한 중간 보고입니다. 숫자와 이름은 모두 지어낸 것입니다.",
    "",
    "```lina:callout decision 배포 순서를 정해 주세요",
    "결제 화면 변경을 먼저 내보낼지, 검색 개선과 함께 내보낼지 답이 필요합니다.",
    "```",
    "",
    "# 요약",
    "",
    "변경 **42건**을 묶음 14개로 나눴고, 그중 11개가 검토를 통과했습니다. 나머지 셋은 *시험 결과*를 기다립니다. 묶음마다 한 줄 요약을 붙였고, 아래 표에 모았습니다.",
    "",
    "- 화면 문구: 18건",
    "- 오류 처리: 9건",
    "- 문서: 15건",
    "",
    "## 묶음별 변경",
    "",
    "넓은 표는 옆으로 밀어서 봅니다. 휴대폰에서는 행마다 카드로 접힙니다.",
    "",
    WIDE_TABLE,
    "",
    "## 화면",
    "",
    '![변경 목록 화면](images/0 "변경 목록 화면: 묶음마다 한 줄 요약")',
    "",
    '![요약 칸](images/1 "요약 칸") ![확인 표](images/2 "확인 표")',
    "",
    "보고서 밖 그림은 그리지 않습니다: ![밖의 그림](https://example.invalid/outside.png)",
    "",
    "## 추이",
    "",
    "```lina:chart line 하루 변경 수",
    "| 날짜 | 변경 | 검토 |",
    "| --- | ---: | ---: |",
    "| 월 | 4 | 2 |",
    "| 화 | 9 | 5 |",
    "| 수 | 7 | 7 |",
    "| 목 | 12 | 8 |",
    "| 금 | 10 | 11 |",
    "```",
    "",
    "```lina:chart bar 가상 기기 디스크 사용 (GB)",
    "| 기기 | 사용 | 남음 |",
    "| --- | ---: | ---: |",
    "| 가상-1 | 412 | 88 |",
    "| 가상-2 | 230 | 270 |",
    "| 가상-3 | 95 | 405 |",
    "```",
    "",
    "```lina:chart share 변경 종류",
    "| 종류 | 건수 |",
    "| --- | ---: |",
    "| 화면 문구 | 18 |",
    "| 오류 처리 | 9 |",
    "| 문서 | 15 |",
    "```",
    "",
    "```lina:chart 이번 주 합계",
    "| 항목 | 값 |",
    "| --- | ---: |",
    "| 변경 | 42 |",
    "```",
    "",
    "## 흐름",
    "",
    "```mermaid",
    "flowchart LR",
    "  A[변경 모으기] --> B{검토}",
    "  B -->|통과| C[노트에 싣기]",
    "  B -->|보류| D[다시 쓰기]",
    "  D --> B",
    "  C --> E[가상 배포 준비]",
    "  E --> F[주인 확인]",
    "  F --> G[내보내기]",
    "```",
    "",
    "```lina:callout warning 시험 하나가 느립니다",
    "가상 묶음 7의 시험이 평소보다 세 배 걸립니다.",
    "```",
    "",
    "````lina:fold 자세한 확인 기록",
    "확인한 순서대로 적었습니다.",
    "",
    "1. 변경 목록을 모음",
    "2. 묶음마다 요약을 붙임",
    "3. 검토 결과를 표에 옮김",
    "",
    "```lina:callout decision 접힌 곳 안의 결정",
    "가상 묶음 12를 이번에 넣을지 정해 주세요.",
    "```",
    "",
    "```lina:callout note",
    "참고로, 이 상자는 조용한 알림입니다.",
    "```",
    "````",
    "",
    "## 다음 할 일",
    "",
    "- [x] 묶음 나누기",
    "- [ ] 남은 시험 결과 받기",
    "- [ ] 배포 순서 확인",
    "",
    ...Array.from({ length: edits }, (_, index) => `> 추가된 문단 ${index + 1}: 에이전트가 보고서를 고쳐 새 버전을 올렸습니다.`),
  ].join("\n");
}

const LEGACY_BODY = [
  "블록이 없는 예전 모양의 보고서입니다. 그대로 읽혀야 합니다.",
  "",
  "# 점검한 것",
  "",
  "가상 백업 세 곳을 확인했습니다. 자세한 절차는 [가상 안내](https://example.invalid/guide)에 있습니다.",
  "",
  "## 결과",
  "",
  "| 백업 | 크기 | 마지막 복구 연습 |",
  "| --- | ---: | --- |",
  "| 가상 백업 A | 1,240 GB | 3일 전 |",
  "| 가상 백업 B | 380 GB | 12일 전 |",
  "| 가상 백업 C | 75 GB | 없음 |",
  "",
  "> 백업 C는 복구 연습을 한 적이 없습니다.",
  "",
  "```",
  "restore --dry-run fake-backup-c",
  "```",
  "",
  "1. 백업 C 복구 연습",
  "2. 주기를 주 1회로",
  "",
  "---",
  "",
  "끝.",
].join("\n");

const BROKEN_BODY = [
  "블록이 틀리면 원문과 한 줄 오류를 보여 줍니다. 아무것도 사라지지 않습니다.",
  "",
  "```lina:chart bar 숫자가 아닌 칸",
  "| 기기 | 사용 |",
  "| --- | ---: |",
  "| 가상-1 | 많음 |",
  "```",
  "",
  "```lina:chart",
  "표가 없는 차트",
  "```",
  "",
  "```lina:map 모르는 블록",
  "가상 지도",
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  "  A --> ",
  "  ((( 닫히지 않음",
  "```",
  "",
  "```lina:callout shout 모르는 종류",
  "```",
  "",
  "```lina:fold",
  "제목 없는 접힌 부분",
  "```",
  "",
  "틀린 블록 뒤의 문단도 그대로 보입니다.",
].join("\n");

const NESTED_BODY = [
  "그림이 블록 안에만 있는 보고서입니다.",
  "",
  "````lina:fold 접힌 곳의 그림",
  '![접힌 곳](images/0 "접힌 곳 안의 그림")',
  "````",
  "",
  "```lina:callout note 상자 안의 그림",
  '![상자](images/1 "상자 안의 그림")',
  "```",
  "",
  "| 이름 | 화면 |",
  "| --- | --- |",
  '| 가상 표 | ![칸](images/2 "칸 안의 그림") |',
  "",
  "코어가 주지 않는 그림은 한 줄로 알립니다:",
  "",
  '![빠진 그림](images/9 "불러오지 못하는 그림")',
].join("\n");

const SLOW_BODY = [
  "첫째 그림이 늦게 옵니다. 그 전에 셋째 그림을 크게 열어 두면, 첫째가 온 뒤에도 셋째가 그대로 보여야 합니다.",
  "",
  '![첫째](images/0 "첫째 그림, 늦게 옴")',
  "",
  '![둘째](images/1 "둘째 그림") ![셋째](images/2 "셋째 그림")',
].join("\n");

const NEGATIVE_BODY = [
  "비율 차트는 음수를 받지 않고 원문과 이유를 보여 줍니다. 막대와 선 차트는 음수를 그립니다.",
  "",
  "```lina:chart share 가상 손익 비율",
  "| 항목 | 값 |",
  "| --- | ---: |",
  "| 가 | -10 |",
  "| 나 | 20 |",
  "```",
  "",
  "```lina:chart stacked 가상 월별 비율",
  "| 달 | 가 | 나 |",
  "| --- | ---: | ---: |",
  "| 1월 | 3 | 4 |",
  "| 2월 | 5 | −2 |",
  "```",
  "",
  "```lina:chart bar 가상 손익",
  "| 달 | 손익 |",
  "| --- | ---: |",
  "| 1월 | 12 |",
  "| 2월 | -8 |",
  "| 3월 | 5 |",
  "```",
  "",
  "```lina:chart line 가상 기온",
  "| 날 | 기온 |",
  "| --- | ---: |",
  "| 월 | -3 |",
  "| 화 | 1 |",
  "| 수 | -1 |",
  "```",
].join("\n");

/** The four reports at `now`: the long one with three versions (k-101, G1), the legacy one, the broken one, and one whose images sit only inside blocks. */
export function syntheticReports(now: number, agents: readonly string[], options: { card: string; goal: string }): Record<string, SceneReport> {
  const base = { private: false, page: "" };
  return {
    [REPORT_IDS.long]: {
      summary: { ...base, id: REPORT_IDS.long, agent: agents[0], card: options.card, goal: options.goal, createdAt: now - 6 * HOUR, page: `/reports/${REPORT_IDS.long}/page` },
      versions: [
        { version: 1, at: now - 6 * HOUR, title: "가상 릴리스 변경 정리", summary: "변경 목록 첫 정리", body: longBody(0).split("## 추이")[0] },
        { version: 2, at: now - 2 * HOUR, title: "가상 릴리스 변경 정리 · 중간 보고", summary: "묶음과 그림을 더함", body: longBody(0).split("## 흐름")[0] },
        { version: 3, at: now - 12 * MIN, title: "가상 릴리스 변경 정리 · 중간 보고", summary: "차트, 흐름도, 확인 기록까지", body: longBody(0) },
      ],
    },
    [REPORT_IDS.legacy]: {
      summary: { ...base, id: REPORT_IDS.legacy, agent: agents[0], card: null, goal: null, createdAt: now - 3 * 86_400, page: `/reports/${REPORT_IDS.legacy}/page` },
      versions: [{ version: 1, at: now - 3 * 86_400, title: "가상 백업 점검 메모", summary: "백업 세 곳의 상태", body: LEGACY_BODY }],
    },
    [REPORT_IDS.nested]: {
      summary: { ...base, id: REPORT_IDS.nested, agent: agents[0], card: null, goal: null, createdAt: now - 30 * MIN, page: `/reports/${REPORT_IDS.nested}/page` },
      versions: [{ version: 1, at: now - 30 * MIN, title: "가상 블록 안 그림 예시", summary: "접힌 곳·상자·표 칸의 그림", body: NESTED_BODY }],
    },
    [REPORT_IDS.slow]: {
      summary: { ...base, id: REPORT_IDS.slow, agent: agents[0], card: null, goal: null, createdAt: now - 20 * MIN, page: `/reports/${REPORT_IDS.slow}/page` },
      versions: [{ version: 1, at: now - 20 * MIN, title: "가상 늦은 그림 예시", summary: "첫째 그림이 늦게 오는 보고서", body: SLOW_BODY }],
    },
    [REPORT_IDS.negative]: {
      summary: { ...base, id: REPORT_IDS.negative, agent: agents[0], card: null, goal: null, createdAt: now - 10 * MIN, page: `/reports/${REPORT_IDS.negative}/page` },
      versions: [{ version: 1, at: now - 10 * MIN, title: "가상 음수 차트 예시", summary: "비율 차트의 음수와 막대·선 차트의 음수", body: NEGATIVE_BODY }],
    },
    [REPORT_IDS.broken]: {
      summary: { ...base, id: REPORT_IDS.broken, agent: agents[1] ?? agents[0], card: null, goal: null, createdAt: now - HOUR, page: `/reports/${REPORT_IDS.broken}/page` },
      versions: [{ version: 1, at: now - HOUR, title: "가상 블록 오류 예시", summary: "틀린 블록이 어떻게 보이는지", body: BROKEN_BODY }],
    },
  };
}

/** The long report edited again by its agent: one more version, a paragraph longer. */
export function editedReport(report: SceneReport, now: number): void {
  const newest = report.versions[report.versions.length - 1];
  const edits = report.versions.length - 2;
  report.versions.push({ version: newest.version + 1, at: now, title: newest.title, summary: `추가 문단 ${edits}개`, body: report.summary.id === REPORT_IDS.long ? longBody(edits) : `${newest.body}\n\n> 추가된 문단 ${edits}` });
}

/** What the first agent sent in its window for the reports: a line and a reference each, and page links in a sentence. */
export function reportMessages(at: number): { role: "assistant"; content: string; timestamp: number }[] {
  return [
    { role: "assistant", content: `중간 보고를 올렸어요.\n[[report:${REPORT_IDS.long}|${pageOf(REPORT_IDS.long)}|가상 릴리스 변경 정리 · 중간 보고]]`, timestamp: at },
    { role: "assistant", content: `지난번 메모예요.\n[[report:${REPORT_IDS.legacy}|${pageOf(REPORT_IDS.legacy)}|가상 백업 점검 메모]]\n블록이 틀린 예시도 있어요: [오류 예시](${pageOf(REPORT_IDS.broken)}). 옛 주소는 그대로 열려요: [옛 보고서](https://hub.invalid/r/old-note).`, timestamp: at + 30 },
  ];
}
