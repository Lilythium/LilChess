import { mount } from "svelte";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import "./app.css";
import { installKeyboardHandling } from "./lib/keyboard";

// The on-screen keyboard resizes the viewport differently on iOS and Android; the web build and the native
// build share this handling (see lib/keyboard.ts).
installKeyboardHandling();

// Keep native-only Capacitor imports out of the ordinary web bundle.
if (import.meta.env.MODE === "native") {
  // Lets app.css switch off browser-only behaviour (overscroll bounce, long-press menus, text selection).
  document.documentElement.classList.add("native");
  const { startNative } = await import("./native/start");
  await startNative();
} else {
  const { default: App } = await import("./App.svelte");
  const { unlockAudio } = await import("./lib/audio/audio");

  addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
  mount(App, { target: document.getElementById("app")! });
}
