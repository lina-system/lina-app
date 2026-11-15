import { fireEvent, render } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { expect, test } from "vitest";
import { KoreanInput } from "./korean-input";

function Host() {
  const [value, setValue] = useState("");
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setTick((n) => n + 1)}>
        tick {tick}
      </button>
      <KoreanInput label="Note" value={value} onValue={setValue} />
      <output>{value}</output>
    </div>
  );
}

function inputOf(view: ReturnType<typeof render>): HTMLInputElement {
  return view.getByRole("textbox", { name: "Note" }) as HTMLInputElement;
}

test("keeps a composing Hangul syllable when the screen re-renders", () => {
  const view = render(<Host />);
  const input = inputOf(view);

  fireEvent.compositionStart(input);
  input.value = "ㅎ";
  fireEvent.input(input, { data: "ㅎ", inputType: "insertCompositionText", isComposing: true });
  fireEvent.click(view.getByRole("button", { name: /tick/ }));

  expect(input.value).toBe("ㅎ");
  expect(view.container.querySelector("output")?.textContent).toBe("");

  input.value = "한";
  fireEvent.compositionEnd(input, { data: "한" });
  fireEvent.input(input, { data: "한", inputType: "insertText", isComposing: false });

  expect(input.value).toBe("한");
  expect(view.container.querySelector("output")?.textContent).toBe("한");
});

test("commits typed Hangul once when composition is not active", () => {
  const view = render(<Host />);
  const input = inputOf(view);
  input.value = "한글";
  fireEvent.input(input, { data: "한글", inputType: "insertText", isComposing: false });
  fireEvent.input(input, { data: "한글", inputType: "insertText", isComposing: false });
  expect(view.container.querySelector("output")?.textContent).toBe("한글");
});

function Field({ sent }: { sent: string[] }) {
  const [value, setValue] = useState("");
  return <KoreanInput label="Note" value={value} onValue={setValue} onEnter={() => sent.push(value)} multiline />;
}

test("a multi-line field: Enter sends, Shift+Enter breaks the line, an Enter that ends a Hangul composition sends nothing", () => {
  const sent: string[] = [];
  const view = render(<Field sent={sent} />);
  const field = view.getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement;
  expect(field.tagName).toBe("TEXTAREA");
  fireEvent.compositionStart(field);
  field.value = "한";
  expect(fireEvent.keyDown(field, { key: "Enter", keyCode: 229, isComposing: true })).toBe(true);
  expect(sent).toEqual([]);
  fireEvent.compositionEnd(field, { data: "한" });
  expect(fireEvent.keyDown(field, { key: "Enter", shiftKey: true })).toBe(true);
  expect(sent).toEqual([]);
  field.value = "한\n줄";
  fireEvent.input(field);
  expect(fireEvent.keyDown(field, { key: "Enter" })).toBe(false);
  expect(sent).toEqual(["한\n줄"]);
});

test("a multi-line field grows with its lines", () => {
  const view = render(<Field sent={[]} />);
  const field = view.getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement;
  Object.defineProperty(field, "scrollHeight", { configurable: true, get: () => (field.value.split("\n").length * 20) });
  field.value = "하나\n둘\n셋";
  fireEvent.input(field);
  expect(field.style.height).toBe("60px");
  field.value = "하나";
  fireEvent.input(field);
  expect(field.style.height).toBe("20px");
});

test("an IME Enter does not replace the composing text", () => {
  const view = render(<Host />);
  const input = inputOf(view);
  fireEvent.compositionStart(input);
  input.value = "한";
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229, isComposing: true });
  expect(input.value).toBe("한");
  expect(view.container.querySelector("output")?.textContent).toBe("");
});
