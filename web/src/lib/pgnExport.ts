import { apiText } from "./api";
import { isNativeApp, shareContent } from "./platform";

const GAME_ID = /^[a-f\d]{8,16}$/i;

export function pgnFileName(gameId: string): string {
  return `lilchess-${gameId}.pgn`;
}

/** The game's PGN from the server (`GET /api/games/:id/pgn`). The server stays the source of truth. */
export async function fetchPgn(gameId: string): Promise<string> {
  if (!GAME_ID.test(gameId)) throw new Error("That game id is not valid.");
  const pgn = await apiText(`/api/games/${gameId}/pgn`);
  if (!pgn.trim()) throw new Error("The server returned an empty PGN.");
  return pgn;
}

function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-chess-pgn;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Browser: saves `lilchess-<id>.pgn`. App: opens the system share sheet with the PGN text (copy it, save it to
 * Files, send it to another chess app). A plain `<a href="/api/.../pgn">` cannot work in the app, because a link
 * click cannot carry the bearer token the server needs.
 */
export async function exportPgn(gameId: string): Promise<void> {
  const pgn = await fetchPgn(gameId);
  if (isNativeApp()) {
    await shareContent({ title: pgnFileName(gameId), text: pgn });
    return;
  }
  downloadText(pgnFileName(gameId), pgn);
}
