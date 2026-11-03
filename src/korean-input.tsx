import { useLayoutEffect, useRef } from "preact/hooks";

type Props = {
  label: string;
  value: string;
  onValue: (value: string) => void;
  /** Shows the label inside the empty field instead of before it; the field keeps it as its accessible name. */
  inline?: boolean;
};

function isImeEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

export function KoreanInput({ label, value, onValue, inline = false }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const composing = useRef(false);

  // Sync before paint: a passive effect can run a frame late and overwrite keys
  // typed in between.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || composing.current) return;
    if (element.value !== value) element.value = value;
  }, [value]);

  const commit = (element: HTMLInputElement) => {
    if (element.value !== value) onValue(element.value);
  };

  return (
    <label class={inline ? "note is-inline" : "note"}>
      {inline ? <span class="visually-hidden">{label}</span> : label}
      <input
        placeholder={inline ? label : undefined}
        ref={ref}
        type="text"
        lang="ko"
        name="lina-note"
        inputMode="text"
        enterKeyHint="done"
        autoCapitalize="none"
        autoCorrect="on"
        spellcheck
        autoComplete="off"
        defaultValue={value}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          commit(event.currentTarget);
        }}
        onInput={(event) => {
          if (composing.current || event.isComposing) return;
          commit(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (isImeEvent(event)) return;
        }}
        onFocus={(event) => {
          const element = event.currentTarget;
          requestAnimationFrame(() => element.scrollIntoView({ block: "center" }));
        }}
      />
    </label>
  );
}
