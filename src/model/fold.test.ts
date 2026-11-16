import { expect, test } from "vitest";
import { foldReason, sentenceMayShow, unitMayShow, unitOf, wholeText, withoutLatin, withoutRefs } from "./fold";

test("a comment shows as it is unless it would show a path, a command, a hash, an issue number, an address or a fragment", () => {
  for (const plain of ["오류 문구 초안을 공유했어요.", "카드 번호는 앞 여섯 자리까지 보여 줄까요?", "1.5배 빨라졌어요."]) expect(foldReason(plain)).toBeNull();
  expect(foldReason("src/payment/card-form 정리")).toBe("path");
  expect(foldReason("CHANGES.md 반영")).toBe("path");
  expect(foldReason("~/notes 보세요")).toBe("path");
  expect(foldReason("npm test --run 돌림")).toBe("command");
  expect(foldReason("`work next` 실행")).toBe("command");
  expect(foldReason("$ make dev 로 확인")).toBe("command");
  expect(foldReason("커밋 3f2a1c9 에 들어감")).toBe("hash");
  expect(foldReason("#36 끝나면 시작")).toBe("issue");
  expect(foldReason("lina-system/lina#201 기다림")).toBe("issue");
  expect(foldReason("https://example.org 참고")).toBe("address");
  expect(foldReason("카드사별로 바꾸는 중인데…")).toBe("fragment");
  expect(foldReason("   ")).toBe("fragment");
  // English words are raw text, except the names the core's checked lines allow.
  expect(foldReason("위키: people 정리")).toBe("latin");
  expect(foldReason("Running npm test in packages")).toBe("latin");
  expect(foldReason("LINA 코어 정리")).toBeNull();
  expect(foldReason("CI 기다림")).toBeNull();
});

test("a title loses its issue references and commit hashes, brackets and all, and keeps its words (lina-app#148)", () => {
  expect(withoutRefs("가상 빌드에 새 판(dev ed0972f8ce) 고정: 기기가 돌아오면 (lina#456·#454 뒷일)")).toBe("가상 빌드에 새 판 고정: 기기가 돌아오면 (뒷일)");
  expect(withoutRefs("가짜 정리 #12 · a1b2c3d")).toBe("가짜 정리");
  expect(withoutRefs("(lina#9) a1b2c3d4e5")).toBe("");
  expect(withoutRefs("1.5배 빨라진 정리")).toBe("1.5배 빨라진 정리");
});

// lina-app#156: the shapes the hub's real titles take, with invented words. A ref goes with the particle glued to it
// and a bracket that only held refs; the rest reads as a sentence.
test.each([
  ["가짜 허브 앱 빌드를 a6687ba로 올리기", "가짜 허브 앱 빌드를 올리기"],
  ["가짜 코어를 dev 0aa65fe53a로 올리기 (lina#575 게이트 반영)", "가짜 코어를 올리기 (게이트 반영)"],
  ["가짜 정리 (lina#49·#50 뒷일)", "가짜 정리 (뒷일)"],
  ["t_ab12cd34 가짜 1주 측정", "가짜 1주 측정"],
  ["[모래 16:52] 가짜 점검 정리", "가짜 점검 정리"],
  ["#12를 먼저 닫고 가짜 정리", "먼저 닫고 가짜 정리"],
  ["가짜 작업 (lina-app #131 뒤 정리)", "가짜 작업 (뒤 정리)"],
  ["G106 가짜 제안 순서 정리", "가짜 제안 순서 정리"],
  ["가짜 검토 (OT-SIO123, 바로 끝내기)", "가짜 검토 (바로 끝내기)"],
  ["가짜 묶음 반영 (#631·#663·앱 #120·#130)", "가짜 묶음 반영"],
  ["lina#434: 가짜 문구 없애기", "가짜 문구 없애기"],
  ["가짜 판(dev ed0972f8ce) 고정", "가짜 판 고정"],
  ["T587 가짜  두 칸 () 정리", "가짜 두 칸 정리"],
  ["가짜 대기 (표지 카드, t_50f7c3ed)", "가짜 대기 (표지 카드)"],
  ["가짜 PR #8 검사 대기", "가짜 PR 검사 대기"],
])("withoutRefs(%j) reads %j (lina-app#156)", (title, cut) => {
  expect(withoutRefs(title)).toBe(cut);
});

// lina-app#160: the punctuation a cut ref leaves behind, in the shapes of the hub's real titles with invented words. The
// branch name before a hash goes with it; doubled commas and dots, empty quotes and brackets, and a separator left at
// either end go too.
test.each([
  ["가짜 코어를 dev 1a2b3c4d5e로, 앱 빌드를 6f7e8d9c로 올리기", "가짜 코어를, 앱 빌드를 올리기"],
  ["가짜 전환 뒷정리: 착지 a1b2c3d,, 전환 문서 한 줄", "가짜 전환 뒷정리: 착지, 전환 문서 한 줄"],
  ["가짜 착지,, 전환 문서", "가짜 착지, 전환 문서"],
  ["가짜 코어 올리기 (가짜 프록시 · #12 · a1b2c3d · #13 · 반영)", "가짜 코어 올리기 (가짜 프록시 · 반영)"],
  ["가짜 코어 올리기 (가짜 프록시 · · · 반영)", "가짜 코어 올리기 (가짜 프록시 · 반영)"],
  ["가짜 코어 올리기 (가짜값 \"\" 반영)", "가짜 코어 올리기 (가짜값 반영)"],
  ["가짜 정리 '' 마무리", "가짜 정리 마무리"],
  ["가짜 판을 main 0aa65fe53a로 고정", "가짜 판을 고정"],
  ["가짜 판 고정 dev 0aa65fe53a,", "가짜 판 고정"],
  ["· 가짜 문서 다듬기 ·", "가짜 문서 다듬기"],
  [", 가짜 문서 다듬기,", "가짜 문서 다듬기"],
  ["가짜 설정 한 줄 (#9) —", "가짜 설정 한 줄"],
  ["가짜 정리 [#4] 마무리", "가짜 정리 마무리"],
  ["가짜 정리 ( · ) 마무리", "가짜 정리 마무리"],
  ["가짜 정리 [ , ] 마무리", "가짜 정리 마무리"],
  ["가짜 묶음: #3, #4, 가짜 반영", "가짜 묶음: 가짜 반영"],
  ["가짜 정리 · #5 · · 마무리", "가짜 정리 · 마무리"],
  ["가짜 정리 (#5, 마무리)", "가짜 정리 (마무리)"],
])("withoutRefs(%j) leaves no punctuation debris: %j (lina-app#160)", (title, cut) => {
  expect(withoutRefs(title)).toBe(cut);
});

// The tidy step is the title cut's own now (lina-app#226): a title with no ref goes through it alone.
test("a title cut collapses the debris itself (lina-app#160)", () => {
  expect(withoutRefs("가짜 착지 ,, 전환 · · 문서 () [] \"\" 끝 ,")).toBe("가짜 착지, 전환 · 문서 끝");
  expect(withoutRefs("( · 가짜 · )")).toBe("(가짜)");
  expect(withoutRefs("1.5배 빨라진 정리 - 가짜")).toBe("1.5배 빨라진 정리 - 가짜");
  expect(withoutRefs("")).toBe("");
});

// lina-app#160: code-looking tokens are cut from a title like a ref, with the particle glued to them and a bracket that
// only held them; card numbering goes too. Names and short abbreviations stay.
test.each([
  ["가짜 fake_lines 요약 모델 바꾸기", "가짜 요약 모델 바꾸기"],
  ["가짜 요약 설정 넣기 (fake.board_lines) + 노출된 FAKE_GATEWAY_KEY 확인", "가짜 요약 설정 넣기 + 노출된 확인"],
  ["가짜 코어 올리기 (FakeRecord.cardId 서버 반영)", "가짜 코어 올리기 (서버 반영)"],
  ["가짜 설정 한 줄 (fakeKeyHelper) —", "가짜 설정 한 줄"],
  ["가짜 가드 고치기 (active_fake)", "가짜 가드 고치기"],
  ["가짜 예외 정리: 깬 카드의 active_fake를 풀기", "가짜 예외 정리: 깬 카드의 풀기"],
  ["가짜 반영 (FAKE_TIMEZONE·skip_fakes) + 재시작", "가짜 반영 + 재시작"],
  ["가짜 잠재 결함 (fake_tether.tether_dev 시리얼 없이 호출)", "가짜 잠재 결함 (시리얼 없이 호출)"],
  ["가짜 대기 보완: 구형 _open_fakes 경로", "가짜 대기 보완: 구형 경로"],
  ["가짜 착지 대기 (표지 카드 8)", "가짜 착지 대기"],
  ["가짜 표지 카드 3 정리", "가짜 정리"],
  ["가짜 card 12 정리", "가짜 정리"],
  ["가짜 카드 3장 정리", "가짜 카드 3장 정리"],
  ["가짜 대기 (표지 카드)", "가짜 대기 (표지 카드)"],
  ["macOS 가짜 정리와 iPhone 가짜 확인", "macOS 가짜 정리와 iPhone 가짜 확인"],
  ["가짜 omo-task 정리, GitHub 확인", "가짜 omo-task 정리, GitHub 확인"],
  ["허브 가짜 .env 배포", "허브 가짜 .env 배포"],
])("withoutRefs(%j) drops internal identifiers: %j (lina-app#160)", (title, cut) => {
  expect(withoutRefs(title)).toBe(cut);
});

// lina-app#222: the one rule every drawn history line, folded comment sentence and title passes, in the shapes the real
// hub's long cards took (round 18), the words made up: (a) no start inside a sentence, (b) no open end, (c) no hole, (d)
// no Latin word or code-like token. A sentence with no Hangul is none either.
test.each([
  ["가짜 빌드를 마쳤다.", true],
  ["가짜 지연이 0.5초 늘었다.", true],
  ["가짜 판 1.2.3을 깔았다.", true],
  ["이 가짜 카드는 멈췄다.", true],
  ["그 일은 오늘 가 볼 예정.", true],
  ["가짜 결과: 배포 성공.", true],
  ["가짜 화면 (두 번째 판) 정리를 마침.", true],
  ["가짜 요청은 '실제'로 바꿈.", true],
  // (a) a start inside a sentence: a dot or a colon, a particle, a bare number with its unit or a list's number.
  [".5초 무렵 다시 봤다.", false],
  [": 가짜 빌드 통과.", false],
  ["을 먼저 고쳤다.", false],
  ["5초.", false],
  ["2.", false],
  ["2) → 가짜 대기로 고침.", false],
  ["1) 가짜 설정이 돌았다.", true],
  // A number and `)` that close a bracket opened before them are that bracket's (lina-app#244); a list's mark closes none.
  ["가짜 묶음(항목 각 6) 기준을 확인했다.", true],
  ["가짜 묶음 (항목 6) 기준을 확인했다.", true],
  ["가짜 묶음 (겉 칸 (속 칸 2) 끝 칸 3) 정리함.", true],
  ["가짜 순서: 1) 빌드를 마친다. 2) 배포를 한다.", true],
  ["가짜 묶음 (항목 6) 다음은 2) 배포를 한다.", true],
  ["가짜 묶음 (겉 칸 (속 칸 2) 끝을 정리함.", false],
  // (b) an open end: a colon, a table's bar, an open bracket or quote.
  ["가짜 순서:", false],
  ["가짜 표 칸 |", false],
  ["가짜 묶음 (", false],
  ["가짜 묶음 (가짜 앞 정리.", false],
  ['가짜 댓글의 세 번 끊겼다"는 틀렸다.', false],
  // (c) a hole: a particle after a space, a modifier with no noun after it.
  ["가짜 파일 를 고쳤다.", false],
  ["가짜 묶음은 이.", false],
  ["가짜 설정은 노출된.", false],
  // (d) a Latin word, a product name, a round label, a code or a ref.
  ["가짜 수정이 merged 되었다.", false],
  ["가짜 PR 검사 대기", false],
  ["Codex 가짜 검토를 받음.", false],
  ["가짜 S2는 뒤에 얹는다.", false],
  ["가짜 묶음 N1·N2를 닫았다.", false],
  ["가짜 결함 D1~D7을 모았다.", false],
  ["가짜 검사가 rc 0으로 끝남.", false],
  ["가짜 정리 #12 끝.", false],
  ["", false],
  ["12:30", false],
])("sentenceMayShow(%j) is %s (lina-app#222)", (sentence, shows) => {
  expect(sentenceMayShow(sentence)).toBe(shows);
});

// lina-app#241: a list is no unit of its own. A comment holding one is drawn whole when it is one line within the limit
// (two sentences, 120 letters) and the one gate passes it, however its marks run; a longer one folds whole. A range is no
// list's mark.
const LIST = "가짜 검토 결과: (1) 첫 화면 문구를 맞췄다. (2) 버튼을 아래로 옮겼다. (3) 카드사 이름을 굵게 바꿨다.";
test.each([
  [LIST, null],
  [`${LIST} 다음 문장도 있다.`, null],
  ["가짜 순서: 1) 빌드를 마친다. 2) 배포를 한다.", "가짜 순서: 1) 빌드를 마친다. 2) 배포를 한다."],
  ["가짜 차례: 2. 금액 칸을 누른다. 1. 목록을 연다.", "가짜 차례: 2. 금액 칸을 누른다. 1. 목록을 연다."],
  ["(1) 가짜 목록을 연다. ② 금액 칸을 누른다.", "(1) 가짜 목록을 연다. ② 금액 칸을 누른다."],
  ["가짜 남은 일: (1) 영수증 금액 줄을 다시 본다.\n(2) 환불 문구 확인.", null],
  ["가짜 순서는 1.", null],
  ["가짜 보고(검토 기간 11-16) 내용을 고쳤다.", "가짜 보고(검토 기간 11-16) 내용을 고쳤다."],
])("wholeText(%j) is %j: a list is drawn whole or folds whole with its comment (lina-app#241)", (text, drawn) => {
  expect(wholeText(text)).toBe(drawn);
});

// lina-app#228: a ref or a Latin word cut from between a separator (or the title's start) and the bracket after it
// leaves that bracket an aside on nothing (`손보기: (지난 판 되돌림) 이후`): a hole, so the cut gives nothing. A bracket the title
// itself opens after its colon, with nothing cut, stays; one that ends the title is the colon's aside, its colon gone.
test.each([
  ["가짜 정산 표 손보기: lina-app#12(지난 판 되돌림) 이후 마무리", ""],
  ["가짜 정산 표 손보기: lina#12 (지난 판 되돌림) 이후 마무리", ""],
  ["가짜 정리 · a1b2c3d(앞 판) 뒤 마무리", ""],
  ["lina#12(지난 판 되돌림) 이후 마무리", ""],
  ["가짜 요약: (초안) 문서 정리", "가짜 요약: (초안) 문서 정리"],
  ["가짜 반영: lina#12 (앞 판)", "가짜 반영 (앞 판)"],
])("withoutRefs(%j) is %j: no bracket is left after a separator a ref was cut from (lina-app#228)", (title, cut) => {
  expect(withoutRefs(title)).toBe(cut);
});

test("a Latin word cut from before a bracket after the colon leaves the same hole (lina-app#228)", () => {
  expect(withoutLatin("가짜 정산 표 손보기: Sheet(지난 판 되돌림) 이후 마무리")).toBe("");
  expect(withoutLatin("가짜 정산 Sheet 표 손보기: (지난 판) 이후 마무리")).toBe("가짜 정산 표 손보기: (지난 판) 이후 마무리");
});

// lina-app#228: a run of seven digits or more is a hash with no letter in it (a short commit hash). A sentence holding
// it is not drawn, as one holding any code-like token, and a bracket of it alone goes, as one of any hash; six digits and
// a number with its commas are counts.
test.each([
  ["가짜 판은 아직 4815162342 그대로다.", []],
  ["가짜 판은 아직 1234567 그대로다.", []],
  ["가짜 판을 다시 올렸다 (4815162342).", ["가짜 판을 다시 올렸다."]],
  ["가짜 대기 건수가 123456건으로 늘었다.", ["가짜 대기 건수가 123456건으로 늘었다."]],
  ["가짜 대기 건수가 1,234,567건으로 늘었다.", ["가짜 대기 건수가 1,234,567건으로 늘었다."]],
])("wholeText(%j) is %j: a digits-only hash is never drawn (lina-app#228)", (text, drawn) => {
  expect(wholeText(text)).toBe(drawn[0] ?? null);
});

// lina-app#230: a sentence holding exactly one time of day with a Korean particle or word glued after it (`12:50에`,
// `12:50경`) is a plain fact, drawn when it is otherwise drawable: the row's own time beside it is another time and both read.
// Two times, a time with seconds, or one followed by a space (a log line's head), a separator, an end mark or nothing are not drawn.
test.each([
  ["가짜 판을 12:50에 배포했다.", ["가짜 판을 12:50에 배포했다."]],
  ["가짜 검토는 9:05부터 다시 했다.", ["가짜 검토는 9:05부터 다시 했다."]],
  ["가짜 정리를 14:00까지 마친다.", ["가짜 정리를 14:00까지 마친다."]],
  ["가짜 배포가 12:50경 끝났다.", ["가짜 배포가 12:50경 끝났다."]],
  ["가짜 배포가 12:50쯤 끝났다.", ["가짜 배포가 12:50쯤 끝났다."]],
  ["22:45 기준으로 가짜 문구를 다시 확인함.", []],
  ["12:50 가짜 배포 시작", []],
  ["가짜 배포를 12:50에 시작해 13:05에 마쳤다.", []],
  ["12:50 · 가짜 배포를 마쳤다.", []],
  ["12:50 — 가짜 배포를 마쳤다.", []],
  ["12:50 - 가짜 배포를 마쳤다.", []],
  ["12:50 | 가짜 배포를 마쳤다.", []],
  ["가짜 배포를 마쳤다 12:50", []],
  ["가짜 배포 시각은 12:50.", []],
  ["가짜 배포를 12:50:33에 마쳤다.", []],
  ["가짜 대비는 3.55:1로 올랐다.", ["가짜 대비는 3.55:1로 올랐다."]],
])("wholeText(%j) is %j: one time of day with its particle is a fact (lina-app#230)", (text, drawn) => {
  expect(wholeText(text)).toBe(drawn[0] ?? null);
});

// lina-app#230: a run of seven digits or more with a unit glued after it (`원`, `건`) or a thousands comma is a number,
// drawn as any; with nothing after it, a particle or a space, it stays a hash and its sentence is not drawn.
test.each([
  ["가짜 가격은 12345678원으로 정했다.", ["가짜 가격은 12345678원으로 정했다."]],
  ["가짜 누적 건수가 1234567건을 넘었다.", ["가짜 누적 건수가 1234567건을 넘었다."]],
  ["가짜 매출은 1234567,890원이다.", ["가짜 매출은 1234567,890원이다."]],
  ["가짜 판은 아직 1234567 그대로다.", []],
  ["가짜 해시 1234567을 지웠다.", []],
  ["가짜 판을 4815162342로 올렸다.", []],
  ["가짜 판은 4815162342.", []],
])("wholeText(%j) is %j: a long number with its unit is a number, not a hash (lina-app#230)", (text, drawn) => {
  expect(wholeText(text)).toBe(drawn[0] ?? null);
  expect(foldReason(text)).toBe(drawn.length ? null : "hash");
});

test("a title holding a digits-only hash passes the sentence rule only once the hash is cut (lina-app#228)", () => {
  expect(sentenceMayShow("가짜 판은 아직 4815162342 그대로다.")).toBe(false);
  expect(withoutRefs("가짜 빌드 4815162342 올리기")).toBe("가짜 빌드 올리기");
});


// lina-app#222, #226, #241: comment shapes of round 18 and the hub's real ones, the words made up, the address host an
// example name. The one gate reads the whole unit: one sentence that fails it folds the unit, and nothing is cut out of it.
test.each([
  ["가짜 순서:\n1. 가짜 빌드 통과.\n2. `fake run`\n3. 가짜 화면 확인.", false],
  ["가짜 할 일 1. fake build 정리. 가짜 시험을 마침.", false],
  ["가짜 지연이 0.5초 늘었다. 가짜 판 1.2.3을 깔았다.", true],
  ["가짜 담당자가 \"검사가 실패했다. 다시 시도하자.\"라고 말했다.", true],
  ["가짜 설정 notes.md를 고쳤다. 가짜 시험을 마침.", false],
  ["copy/fake.json 키 12개를 바꿈 (3f2a1c9)", false],
  ["가짜 수정이 merged 되었다. 가짜 시험을 마침.", false],
  ['가짜 댓글의 세 번 끊겼다"는 틀렸다. 가짜 시험을 마침.', false],
  ["가짜 S2는 뒤에 얹는다. 가짜 결함 D1~D7을 모았다.", false],
  ["백업 대체는 t_e6e0f90a 가 맡는다.", false],
  ["남은 범위 lina#718 라 카드 완료 금지.", false],
  ["주소: http://hub.example.com:8080/ 되돌릴 커밋: e37e43f", false],
  ["그 일은 오늘 가 볼 예정.", true],
  ["주소: 아직 정하지 않음.", true],
  ["(…)", false],
  ["결과: ✅", true],
  ["결과: 배포 성공, 커밋: a1b2c3d. 정리함.", false],
  ["fake_option' 값은 꺼져 있다. 다음 판에서 다시 확인함.", false],
  ["그 뒤 디스패처가 152번 `fake_field` 로 막았다.", false],
  ["안전망 =2026-11-16T03:30+09:00", false],
  ["확인할 가짜 결과:", false],
  ["확인할 가짜 결과:\n1. 가짜 빌드 통과.\n2. 가짜 시험 통과.\n3. 가짜 화면 확인.", true],
  ["남은 일: 1. 설정을 고친다. 2. 서버를 켠다. 고치는 중이", false],
  ["남은 일: 1) 목록을 연다. 3) 금액 칸을 누른다.", true],
  ["가짜 묶음(항목 각 6) 기준을 확인했다.", true],
  ["가짜 금액 줄을 다시 붙였고 그 뒤에 세부를", false],
  ["가짜 항목을 하나 추가.", true],
])("unitMayShow(unitOf(%j)) is %s: the gate reads the unit whole (lina-app#241)", (text, shows) => {
  expect(unitMayShow(unitOf(text))).toBe(shows);
});

test("a unit is the text as written, less its markers, its opening stamp and brackets of refs alone; its lines stay (lina-app#241)", () => {
  expect(unitOf("[가짜 기록 11-16 09:41 · 목표] **가짜 줄을 붙였다** (lina#12).\n둘째 줄  그대로.")).toBe("가짜 줄을 붙였다.\n둘째 줄 그대로.");
});



// lina-app#218: the shapes the hub's comments and titles took after a cut (round 17), the words made up. A particle glued
// to a bracket the cut took whole goes back onto the word before it; a colon with only a bracket after it goes.
test.each([
  ["가짜 관문(lina#12)을 옮기기", "가짜 관문을 옮기기"],
  ["가짜 카드(t_ab12cd34)를 열 때 확인", "가짜 카드를 열 때 확인"],
  ["가짜 워크트리(a1b2c3d4e5)에서 확인", "가짜 워크트리에서 확인"],
  ["가짜 설정(fake_lines)의 값 정리", "가짜 설정의 값 정리"],
  ["가짜 묶음 (표지 카드 8)은 닫기", "가짜 묶음은 닫기"],
  ["가짜 파일에서 fake_owner()를 저장된 값으로 바꾼다", "가짜 파일에서 저장된 값으로 바꾼다"],
  ["가짜 저장소(가짜 사본 t_ab12cd34 따로)에서 돌린다", "가짜 저장소(가짜 사본 따로)에서 돌린다"],
  ["가짜 앱 반영: (가짜 17회차 앞)", "가짜 앱 반영 (가짜 17회차 앞)"],
  ["가짜 앱 반영: (lina#9 가짜 17회차 앞)", "가짜 앱 반영 (가짜 17회차 앞)"],
  ["가짜 묶음: (가짜 앞) 뒤 정리", "가짜 묶음: (가짜 앞) 뒤 정리"],
  ["가짜 설정 고침 + t_ab12cd34 목록 정리", "가짜 설정 고침 + 목록 정리"],
  ["가짜 조건 (가짜 값 = a1b2c3d4e5).", "가짜 조건."],
])("withoutRefs(%j) leaves no particle apart and no colon before a lone bracket: %j (lina-app#218)", (title, cut) => {
  expect(withoutRefs(title)).toBe(cut);
});

test("a finished title's Latin words cut from a bracket leave its particle on the word before it (lina-app#218)", () => {
  expect(withoutLatin("가짜 관문(fake-gate·fake-board)을 옮기기")).toBe("가짜 관문을 옮기기");
});

// lina-app#218: a cut that leaves a hole (a modifier whose noun was cut, a range or pair with a cut end) is no sentence:
// the comment shows its next one, a title nothing.
test.each([
  ["새 a1b2c3d4e5로 충족됨."],
  ["더 새 dev 0aa65fe53a로 충족됨."],
  ["모든 lina#12를 닫았다."],
  ["새 t_ab12cd34로 옮겼다."],
  ["노출된 FAKE_KEY를 지웠다."],
  ["새 판은 a1b2c3d4e5."],
  ["대신 lina#12·lina#13과 파일이 겹치면 먼저 둔다."],
  ["가짜 범위 lina#12~lina#14는 본문에 있다."],
  ["가짜 짝 lina#12 ↔ t_ab12cd34 정리."],
  ["가짜 두 묶음+fake_config 정리."],
])("withoutRefs(%j) is empty: the cut left a hole (lina-app#218)", (text) => {
  expect(withoutRefs(text)).toBe("");
  expect(wholeText(`${text} 가짜 시험을 마침.`)).toBeNull();
});

test("the round 17 comment shape folds whole: no sentence of it is drawn apart (lina-app#218, #241)", () => {
  expect(wholeText("이 가짜 카드의 끝 조건(가짜 값 = a1b2c3d4e5f6)은 더 새 dev 0aa65fe53a로 충족됨. 가짜 시험을 마친 뒤 닫아도 된다.")).toBeNull();
});


test.each([
  ["설정 파일을 고쳤다. 고치는 중이", null],
  ["고치는 중이. 설정 파일을 고쳤다.", null],
  ["설정 파일을 고쳤다. 서버를 켰다.", "설정 파일을 고쳤다. 서버를 켰다."],
])("wholeText(%j) is %j: a complete sentence does not mask a cut-off one (lina-app#239 review)", (text, drawn) => {
  expect(wholeText(text)).toBe(drawn);
});

