import { mount } from "svelte";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import "./app.css";

// Keep native-only Capacitor imports out of the ordinary web bundle.
if (import.meta.env.MODE === "native") {
  const { startNative } = await import("./native/start");
  await startNative();
} else {
  const { default: App } = await import("./App.svelte");
  const { unlockAudio } = await import("./lib/audio/audio");

  addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
  mount(App, { target: document.getElementById("app")! });
}
