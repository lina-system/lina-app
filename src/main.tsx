import { render } from "preact";
import { App } from "./app";
import { choosePushHost, chooseSource } from "./data/select";
import { Store } from "./data/store";
import { bindKeyboardInset } from "./keyboard-inset";
import { registerServiceWorker } from "./pwa";
import "./design/tokens.css";
import "./app.css";

bindKeyboardInset();
registerServiceWorker();

const root = document.getElementById("app");
if (!root) throw new Error("missing #app");
const source = chooseSource();
render(<App store={new Store(source)} pushHost={choosePushHost(source)} />, root);
