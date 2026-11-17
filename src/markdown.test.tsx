import { render } from "@testing-library/preact";
import { expect, test } from "vitest";
import { Markdown, plainLine } from "./markdown";

// The rules of the agent's reply in 대화 (lina-app#187), one case per rule: what is drawn, and what stays plain text.

function draw(text: string) {
  return render(<Markdown text={text} />).container.firstElementChild as HTMLElement;
}

function tags(root: Element): string[] {
  return [...root.querySelectorAll("*")].map((element) => element.tagName.toLowerCase());
}

test("bold, italic and inline code are drawn, never as raw marks", () => {
  const root = draw("이건 **굵게**, *기울게*, _밑줄 기울게_, `agents` 입니다");
  expect(root.querySelector("strong")?.textContent).toBe("굵게");
  expect([...root.querySelectorAll("em")].map((em) => em.textContent)).toEqual(["기울게", "밑줄 기울게"]);
  expect(root.querySelector("code")?.textContent).toBe("agents");
  expect(root.textContent).toBe("이건 굵게, 기울게, 밑줄 기울게, agents 입니다");
});

test("marks inside inline code stay as they are", () => {
  const root = draw("`**not bold**` and ``a ` b``");
  expect(root.querySelector("strong")).toBeNull();
  expect([...root.querySelectorAll("code")].map((code) => code.textContent)).toEqual(["**not bold**", "a ` b"]);
});

test("an underscore inside a word is not a mark", () => {
  const root = draw("snake_case_name stays");
  expect(root.querySelector("em")).toBeNull();
  expect(root.textContent).toBe("snake_case_name stays");
});

test("a fenced code block keeps its lines in a monospace block of its own", () => {
  const root = draw("앞\n```ts\nconst a = 1;\n  **b**\n```\n뒤");
  const pre = root.querySelector("pre");
  expect(pre?.className).toBe("md-code");
  expect(pre?.querySelector("code")?.textContent).toBe("const a = 1;\n  **b**");
  expect(pre?.querySelector("strong")).toBeNull();
  expect([...root.querySelectorAll(":scope > p")].map((p) => p.textContent)).toEqual(["앞", "뒤"]);
});

test("bullet and numbered lists are lists; a numbered list keeps its first number", () => {
  const root = draw("- 하나\n* 둘\n+ **셋**\n\n3. 셋째\n4) 넷째");
  expect([...root.querySelectorAll("ul > li")].map((li) => li.textContent)).toEqual(["하나", "둘", "셋"]);
  expect(root.querySelector("ul > li strong")?.textContent).toBe("셋");
  const ol = root.querySelector("ol");
  expect(ol?.getAttribute("start")).toBe("3");
  expect([...root.querySelectorAll("ol > li")].map((li) => li.textContent)).toEqual(["셋째", "넷째"]);
});

test("a task list item draws a read-only check, named for its state, instead of its [ ] or [x] (lina-app#190)", () => {
  const root = draw("- [ ] 하나\n- [x] **둘**\n* [X] 셋\n1. [ ] 넷\n- [가] 다섯");
  const checks = [...root.querySelectorAll("li > input")] as HTMLInputElement[];
  expect(checks.map((check) => [check.type, check.checked, check.disabled, check.getAttribute("aria-label")])).toEqual([
    ["checkbox", false, true, "완료 안 됨"],
    ["checkbox", true, true, "완료"],
    ["checkbox", true, true, "완료"],
    ["checkbox", false, true, "완료 안 됨"],
  ]);
  expect([...root.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["하나", "둘", "셋", "넷", "[가] 다섯"]);
  expect(root.querySelector("li strong")?.textContent).toBe("둘");
  expect(plainLine("- [x] **정리한** 일")).toBe("정리한 일");
});

test("a nested list item is drawn as an item of the same list", () => {
  const root = draw("- 위\n  - 아래");
  expect([...root.querySelectorAll("ul > li")].map((li) => li.textContent)).toEqual(["위", "아래"]);
  expect(root.querySelectorAll("ul")).toHaveLength(1);
});

test("a blockquote holds its own lines", () => {
  const root = draw("> 인용 **한 줄**\n> 둘째 줄\n\n본문");
  const quote = root.querySelector("blockquote");
  expect(quote?.textContent).toBe("인용 한 줄둘째 줄");
  expect(quote?.querySelectorAll("br")).toHaveLength(1);
  expect(root.querySelector(":scope > p")?.textContent).toBe("본문");
});

test("a heading is bold text, not a page heading", () => {
  const root = draw("## 요약\n내용");
  expect(root.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
  expect(root.querySelector("p.md-heading > strong")?.textContent).toBe("요약");
});

test("a table is a table inside its own sideways-scrolling box, with each column's alignment", () => {
  const root = draw("| 이름 | 수 |\n| :--- | ---: |\n| 가 | 1 |\n| `나` | 22 |\n\n끝줄");
  const box = root.querySelector(".md-table");
  expect(box?.firstElementChild?.tagName).toBe("TABLE");
  expect([...root.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["이름", "수"]);
  expect([...root.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent))).toEqual([
    ["가", "1"],
    ["나", "22"],
  ]);
  expect((root.querySelector("tbody td:last-child") as HTMLElement).style.textAlign).toBe("right");
  expect(root.querySelector("tbody td code")?.textContent).toBe("나");
});

test("a links address keeps one level of parentheses, in the bubble and in an agent rows preview", () => {
  const root = draw("[위키](https://en.wikipedia.org/wiki/Function_(mathematics)) 와 [끝](https://example.com/a).");
  const links = [...root.querySelectorAll("a")];
  expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://en.wikipedia.org/wiki/Function_(mathematics)", "https://example.com/a"]);
  expect(root.textContent).toBe("위키 와 끝.");
  expect(plainLine("[위키](https://en.wikipedia.org/wiki/Function_(mathematics)) 참고")).toBe("위키 참고");
});

test("links open http, https and mailto in a new tab with noopener noreferrer", () => {
  const root = draw("[문서](https://example.com/a?b=1) [메일](mailto:owner) [옛](http://example.com)");
  const links = [...root.querySelectorAll("a")];
  expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://example.com/a?b=1", "mailto:owner", "http://example.com"]);
  for (const link of links) {
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  }
  expect(links.map((link) => link.textContent)).toEqual(["문서", "메일", "옛"]);
});

test("a link to any other scheme is not a link; its source shows as plain text", () => {
  const root = draw("[x](javascript:alert(1)) [y](data:text/html,hi) [z](/relative)");
  expect(root.querySelector("a")).toBeNull();
  expect(root.textContent).toBe("[x](javascript:alert(1)) [y](data:text/html,hi) [z](/relative)");
});

test("raw HTML in a reply is text, never an element", () => {
  const root = draw('<img src=x onerror="alert(1)"> <script>alert(2)</script> <b>b</b>\n\n<a href="javascript:alert(3)">a</a>');
  expect(tags(root).filter((tag) => !["p", "br"].includes(tag))).toEqual([]);
  expect(root.textContent).toContain('<img src=x onerror="alert(1)">');
  expect(root.textContent).toContain("<script>alert(2)</script>");
});

test("images, bare addresses and strikethrough are not drawn: they stay as written", () => {
  const root = draw("![그림](https://example.com/a.png) https://example.com ~~x~~");
  expect(root.querySelector("img, a, s, del")).toBeNull();
  expect(root.textContent).toBe("![그림](https://example.com/a.png) https://example.com ~~x~~");
});

test("a backslash keeps the next mark as text", () => {
  const root = draw("\\*별\\* 그대로");
  expect(root.querySelector("em")).toBeNull();
  expect(root.textContent).toBe("*별* 그대로");
});

test("while a reply streams, an unclosed mark is plain text until it closes", () => {
  expect(draw("이건 **굵").querySelector("strong")).toBeNull();
  expect(draw("이건 **굵").textContent).toBe("이건 **굵");
  expect(draw("값은 `age").textContent).toBe("값은 `age");
  expect(draw("[문서](https://exa").querySelector("a")).toBeNull();
  const open = draw("코드\n```ts\nconst a = 1;");
  expect(open.querySelector("pre")).toBeNull();
  expect(open.textContent).toBe("코드```tsconst a = 1;");
  expect(draw("이건 **굵게**").querySelector("strong")?.textContent).toBe("굵게");
});

test("an agent row's one-line preview shows the reply's words without its marks", () => {
  expect(plainLine("## 오늘 정리\n내용")).toBe("오늘 정리");
  expect(plainLine("\n> **배포**는 `금요일`")).toBe("배포는 금요일");
  expect(plainLine("- [문서](https://example.com)를 _먼저_ 봐요")).toBe("문서를 먼저 봐요");
  expect(plainLine("1. 첫째 *할 일*")).toBe("첫째 할 일");
  expect(plainLine("```sh\nnpm test\n```")).toBe("npm test");
  expect(plainLine("snake_case_name 그대로")).toBe("snake_case_name 그대로");
  expect(plainLine("")).toBe("");
});

test("lines of one paragraph keep their breaks; a blank line starts a new paragraph", () => {
  const root = draw("첫 줄\n둘째 줄\n\n새 문단");
  const paragraphs = [...root.querySelectorAll(":scope > p")];
  expect(paragraphs.map((p) => p.textContent)).toEqual(["첫 줄둘째 줄", "새 문단"]);
  expect(paragraphs[0].querySelectorAll("br")).toHaveLength(1);
});
