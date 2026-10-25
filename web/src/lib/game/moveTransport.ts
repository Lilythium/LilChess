import type { ClientMessage } from "@lilchess/shared";

// How long a move sent over the socket may go unanswered before we stop trusting the board.
export const MOVE_CONFIRM_TIMEOUT_MS = 3_000;

export interface SocketMoveSenderOptions {
  /** Puts the message on the open game socket. Returns false (and sends nothing) if it is not open. */
  send: (msg: ClientMessage) => boolean;
  /** The game's current ply as the client knows it; moves once the server's event has been applied. */
  getPly: () => number | undefined;
  /** The move was refused, or never confirmed: resync from the REST API and put the board back. */
  onRejected: () => void;
  confirmTimeoutMs?: number;
}

/**
 * Sends moves over the game socket instead of a separate HTTP request, so a move needs no new request,
 * cookies or session lookup (and, on mobile, no fresh TCP/TLS handshake after an idle keep-alive expires).
 *
 * The socket gives no per-message acknowledgement, which is fine because the server's answer is always one of:
 *   - the `move` event (it reaches the mover too), which advances the ply; or
 *   - an `error` message (ply_mismatch, not_your_turn, ...), reported through `serverError()`.
 * If neither shows up in time (the connection dropped mid-send), the board is resolved from fresh state.
 * A lost move is never sent again automatically: the ply check on the server would reject a stale repeat,
 * and the player decides what to do after seeing the real position.
 */
export function createSocketMoveSender(options: SocketMoveSenderOptions) {
  const timeoutMs = options.confirmTimeoutMs ?? MOVE_CONFIRM_TIMEOUT_MS;
  const pending = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;

  const reject = () => {
    if (!disposed) options.onRejected();
  };

  return {
    /**
     * True if the move went out on the socket (its outcome arrives as an event or error message).
     * False if the caller should fall back to the HTTP route.
     */
    trySend(ply: number, uci: string): boolean {
      if (disposed || !options.send({ type: "move", ply, uci })) return false;

      const timer = setTimeout(() => {
        pending.delete(timer);
        const current = options.getPly();
        if (current === undefined || current <= ply) reject();
      }, timeoutMs);
      pending.add(timer);
      return true;
    },

    /** The server answered one of our messages with an error. */
    serverError(): void {
      reject();
    },

    dispose(): void {
      disposed = true;
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    },
  };
}
