import type { RouteName, Routes } from "../api/client";
import { generateScene, SYNTHETIC_SEED, type Scene } from "../fixtures/synthetic";
import { nowSeconds, type ReadResult, type Source } from "./source";

function bodyOf(scene: Scene, name: RouteName, id?: string): unknown {
  switch (name) {
    case "board":
      return scene.board;
    case "items":
      return scene.items;
    case "item":
      return id ? scene.itemDetails[id] : undefined;
    case "devices":
      return scene.devices;
    case "quota":
      return scene.quota;
    case "goals":
      return scene.goals;
    case "goal":
      return scene.goals.goals.find((goal) => goal.id === id);
    case "cards":
      return scene.cards;
    case "card":
      return id ? scene.cardDetails[id] : undefined;
    case "inbox":
      return scene.inbox;
  }
}

/** Serves the synthetic scene like the core does: data on the first read of a route, then "unchanged". */
export class SyntheticSource implements Source {
  readonly scene: Scene;
  private readonly served = new Set<string>();

  constructor(options: { seed?: number; now?: number; sourceError?: boolean } = {}) {
    this.scene = generateScene(options.seed ?? SYNTHETIC_SEED, {
      now: Math.floor(options.now ?? nowSeconds()),
      sourceError: options.sourceError,
    });
  }

  async read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<Routes[N]>> {
    const at = nowSeconds();
    const body = bodyOf(this.scene, name, id);
    if (body === undefined) return { kind: "missing", at };
    const key = `${name}:${id ?? ""}`;
    if (this.served.has(key)) return { kind: "unchanged", at };
    this.served.add(key);
    return { kind: "data", data: structuredClone(body) as Routes[N], at };
  }
}
