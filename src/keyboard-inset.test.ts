import { expect, test } from "vitest";
import { bindKeyboardInset, type InsetHost } from "./keyboard-inset";

test("keyboard inset is the height the software keyboard covers", () => {
  const values = new Map<string, string>();
  const host: InsetHost = {
    innerHeight: 800,
    visualViewport: {
      height: 500,
      offsetTop: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    document: {
      documentElement: {
        style: { setProperty: (name, value) => values.set(name, value) },
      },
    },
  };
  bindKeyboardInset(host);
  expect(values.get("--keyboard-inset")).toBe("300px");
});
