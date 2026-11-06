import { createContext } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import type { Source } from "../data/source";
import { Push, type OpenRequest, type PushHost, type PushState } from "../push";
import { W } from "../words";

export const PushCtx = createContext<Push | null>(null);

/** One Push per page: it reads the core's key once and resends a held subscription, without asking for anything. */
export function usePushFor(source: Source, host: PushHost, open: (request: OpenRequest) => void): Push {
  const [, setTick] = useState(0);
  const push = useMemo(() => new Push(source, host, () => setTick((value) => value + 1)), [source, host]);
  useEffect(() => {
    void push.start();
  }, [push]);
  useEffect(() => host.onOpen(open), [host]);
  return push;
}

const LINE: Partial<Record<PushState, string>> = {
  unknown: W.pushUnknown,
  off: W.pushNotSetUp,
  home: W.pushAddToHome,
  unsupported: W.pushUnsupported,
  blocked: W.pushBlocked,
};

/**
 * 알림 받기 in the bell: a switch when this device can take push (permission is asked from it, once), otherwise the
 * one line that says why not.
 */
export function PushRow() {
  const push = useContext(PushCtx);
  if (!push || push.state === "loading") return null;
  const on = push.state === "on";
  const line = LINE[push.state];
  return (
    <div class="push-row" data-testid="push-row" data-state={push.state}>
      {push.state === "ready" || on ? (
        <button type="button" role="switch" class="push-switch" aria-checked={on} disabled={push.busy} onClick={() => void (on ? push.turnOff() : push.turnOn())} data-testid="push-switch">
          <span class="push-label">{W.pushRow}</span>
          <span class="switch" aria-hidden="true" />
        </button>
      ) : (
        <p class="push-switch push-label">{W.pushRow}</p>
      )}
      {line ? (
        <p class="push-line" data-testid="push-line">
          {line}
        </p>
      ) : null}
      {push.error ? (
        <p class="write-error push-line" role="alert" data-testid="push-error">
          {push.error}
        </p>
      ) : null}
    </div>
  );
}
