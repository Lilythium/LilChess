// Coalesces "fetch the authoritative state" requests.
//
// A reconnect, a return to the foreground and a gap in the event stream can all ask for a resync within the
// same moment. Running them concurrently lets an older response arrive last and overwrite a newer state, and
// floods a phone's connection. Instead there is at most one request in flight; asking again (or learning that
// state changed under it) marks it dirty, its possibly-stale answer is discarded, and one fresh request runs.

/** After this many discarded answers in a row the latest answer is applied anyway (a busy game can't starve us). */
export const MAX_DISCARDS = 3;

export interface ResyncRunner {
  /** Resolves when the state is as fresh as the request that was current when this was called. */
  run(): Promise<void>;
  /** The local state changed while a request may be in flight (e.g. a move event was applied). */
  markDirty(): void;
  inFlight(): boolean;
}

export function createResyncRunner<T>(
  fetchState: () => Promise<T>,
  apply: (state: T) => void,
  onError: (error: unknown) => void,
): ResyncRunner {
  let current: Promise<void> | null = null;
  let dirty = false;

  async function loop(): Promise<void> {
    let discards = 0;
    for (;;) {
      dirty = false;
      let state: T | undefined;
      let failure: unknown;
      let failed = false;
      try {
        state = await fetchState();
      } catch (error) {
        failed = true;
        failure = error;
      }

      if (dirty && discards < MAX_DISCARDS) {
        discards += 1;
        continue; // whatever we got may predate a change; ask again instead of applying it
      }
      if (failed) onError(failure);
      else apply(state as T);
      return;
    }
  }

  return {
    run() {
      if (current) {
        dirty = true;
        return current;
      }
      current = loop().finally(() => { current = null; });
      return current;
    },
    markDirty() {
      if (current) dirty = true;
    },
    inFlight: () => current !== null,
  };
}
