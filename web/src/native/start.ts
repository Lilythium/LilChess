import { mount } from "svelte";
import NativeRoot from "./NativeRoot.svelte";

/** Entry point imported only by the Vite `native` build. */
export async function startNative(): Promise<void> {
  const target = document.getElementById("app");
  if (!target) throw new Error("LilChess mobile startup could not find the app root element.");
  mount(NativeRoot, { target });
}
