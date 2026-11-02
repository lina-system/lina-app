type Viewport = {
  height: number;
  offsetTop: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export type InsetHost = {
  innerHeight: number;
  visualViewport: Viewport | null;
  document: {
    documentElement: { style: { setProperty: (name: string, value: string) => void } };
  };
};

export function bindKeyboardInset(host: InsetHost = window): () => void {
  const viewport = host.visualViewport;
  const root = host.document.documentElement;
  const apply = () => {
    const inset = viewport
      ? Math.max(0, host.innerHeight - viewport.height - viewport.offsetTop)
      : 0;
    root.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
  };
  apply();
  if (!viewport) return () => {};
  viewport.addEventListener("resize", apply);
  viewport.addEventListener("scroll", apply);
  return () => {
    viewport.removeEventListener("resize", apply);
    viewport.removeEventListener("scroll", apply);
  };
}
