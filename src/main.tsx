import { render } from "preact";
import { App } from "./app";
import { bootstrapLabel } from "./data/http-source";
import { choosePushHost, chooseSource } from "./data/select";
import { nextPaint, Store } from "./data/store";
import { storedCopy } from "./data/stored";
import { bindKeyboardInset } from "./keyboard-inset";
import { registerServiceWorker } from "./pwa";
import "./design/tokens.css";
import "./app.css";

bindKeyboardInset();
registerServiceWorker();

const root = document.getElementById("app");
if (!root) throw new Error("missing #app");
const source = chooseSource();
render(<App store={new Store(source, { afterPaint: nextPaint, stored: storedCopy(source) })} pushHost={choosePushHost(source)} label={bootstrapLabel()} />, root);
