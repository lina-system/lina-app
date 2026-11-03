import type { RouteName, Routes } from "../api/client";

export type ReadResult<T> =
  | { readonly kind: "data"; readonly data: T; readonly at: number }
  | { readonly kind: "unchanged"; readonly at: number }
  | { readonly kind: "missing"; readonly at: number }
  | { readonly kind: "failed"; readonly offline: boolean; readonly at: number };

/** Where the screens' data comes from: the core over HTTP, or the synthetic scene. */
export interface Source {
  read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<Routes[N]>>;
}

export function nowSeconds(): number {
  return Date.now() / 1000;
}
