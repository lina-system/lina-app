import { useEffect, useRef, useState } from "preact/hooks";
import { KoreanInput } from "../korean-input";
import { writeError } from "../screens/write-error";
import { W } from "../words";
import { useActions } from "./actions";
import { ErrorLine, useApp } from "./parts";

/** 할 일 추가 at the head of 내 할 일 (lina-app#95): opens the one-line form under the head, or closes it. */
export function QuickAddButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" class="text-button quick-add-open" aria-expanded={open} onClick={onToggle} data-testid="quick-add">
      {W.quickAdd}
    </button>
  );
}

/**
 * One line and an optional date, opened in place. Saving writes the owner's to-do to the record (lina#693); its row
 * comes with the record's own read after the core takes it, never drawn before. A refusal keeps the text and shows
 * the core's one line. The field takes focus, which scrolls it clear of the phone's keyboard (KoreanInput).
 */
export function QuickAddForm({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { store } = useApp();
  const actions = useActions();
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>("input[type=text]")?.focus();
  }, []);

  const save = async (event: Event) => {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await store.write((source) => source.addItem({ text: text.trim(), due: due || null }));
    setBusy(false);
    // The add has no route of its own in writeError; a comment's table reads its refusals (text, length, 429).
    if (!result.ok) return setError(writeError("comment", result));
    onAdded();
    actions.note(W.todoAdded);
  };

  return (
    <form ref={form} class="comment-form quick-add-form" onSubmit={(event) => void save(event)}>
      <KoreanInput label={W.quickAddField} value={text} onValue={setText} inline disabled={busy} />
      <label class="note is-inline quick-add-due">
        <span class="visually-hidden">{W.due}</span>
        <input type="date" value={due} disabled={busy} onInput={(event) => setDue(event.currentTarget.value)} />
      </label>
      <button type="submit" class="text-button" disabled={busy || !text.trim()}>
        {W.save}
      </button>
      <button type="button" class="text-button" disabled={busy} onClick={onClose}>
        {W.cancel}
      </button>
      <ErrorLine line={error ?? undefined} />
    </form>
  );
}
