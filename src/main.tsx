import { render } from "preact";
import { App } from "./app";
import { syntheticHome } from "./fixtures/synthetic";
import { bindKeyboardInset } from "./keyboard-inset";
import { registerServiceWorker } from "./pwa";
import "./app.css";

bindKeyboardInset();
registerServiceWorker();

const root = document.getElementById("app");
if (!root) throw new Error("missing #app");
render(<App home={syntheticHome} />, root);
