import { runChessTask, type WorkerRequest, type WorkerResponse } from "./chessTasks";

// Dedicated worker entry. Kept free of DOM and Svelte code so it loads fast. Requests are answered in order.
// Typed by hand (not with the WebWorker lib) so it compiles in the same project as the rest of the web app.
const scope = self as unknown as {
  onmessage: ((event: { data: WorkerRequest }) => void) | null;
  postMessage(message: WorkerResponse): void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, ok: true, value: runChessTask(data.request) });
  } catch (error) {
    scope.postMessage({ id: data.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
