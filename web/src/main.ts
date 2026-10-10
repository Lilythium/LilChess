import { mount } from "svelte";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import "./app.css";
import App from "./App.svelte";
import { unlockAudio } from "./lib/audio/audio";

addEventListener("pointerdown", unlockAudio, { once: true, passive: true });

export default mount(App, { target: document.getElementById("app")! });