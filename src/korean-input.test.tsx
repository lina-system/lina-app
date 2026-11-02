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

test("an IME Enter does not replace the composing text", () => {
  const view = render(<Host />);
  const input = inputOf(view);
  fireEvent.compositionStart(input);
  input.value = "한";
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229, isComposing: true });
  expect(input.value).toBe("한");
  expect(view.container.querySelector("output")?.textContent).toBe("");
});
