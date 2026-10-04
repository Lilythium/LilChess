import { api } from "../api";

// POST /api/games/:id/<path>. Server state wins, so errors are swallowed;
// the caller resyncs afterwards.
export async function postGameAction(id: string, path: string): Promise<void> {
  try {
    await api(`/api/games/${id}/${path}`, { method: "POST" });
  } catch { }
}