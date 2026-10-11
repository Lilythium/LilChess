import type { EngineTransport } from "./engine";

/**
 * Runs the engine in a dedicated Web Worker so analysis never blocks the UI.
 * stockfish-*-single.js *is* the worker script: it finds its .wasm next to itself,
 * takes UCI commands via postMessage and posts each output line back as a string.
 */
export function createWorkerTransport(url: string): EngineTransport {
  const worker = new Worker(url);
  return {
    send: (command) => worker.postMessage(command),
    onLine: (listener) => {
      worker.addEventListener("message", (event: MessageEvent) => {
        if (typeof event.data === "string") listener(event.data); // non-strings are download-progress objects
      });
    },
    onError: (listener) => {
      worker.addEventListener("error", (event: ErrorEvent) => listener(event.message || "engine_failed_to_load"));
      worker.addEventListener("messageerror", () => listener("engine_message_error"));
    },
    terminate: () => worker.terminate(),
  };
}
