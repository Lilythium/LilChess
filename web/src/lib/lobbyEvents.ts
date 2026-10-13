import type { SimulLists, SimulSummary } from "./simul/types";

/**
 * Simuls that are still waiting to start, for the lobby: the viewer's own, ones they're invited to,
 * then public ones anyone can join. A simul can appear in several server lists, so de-duplicate by id.
 */
export function pendingSimuls(lists: Pick<SimulLists, "hosting" | "invitations"> & { open?: SimulSummary[] }): SimulSummary[] {
  const seen = new Set<string>();
  const out: SimulSummary[] = [];
  const candidates = [
    ...(lists.hosting && lists.hosting.status === "open" ? [lists.hosting] : []),
    ...lists.invitations,
    ...(lists.open ?? []),
  ];
  for (const s of candidates) {
    if (s.status !== "open" || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/** Short badge for how the viewer relates to a pending simul. */
export function simulBadge(s: SimulSummary, viewerId: number | undefined): string | null {
  if (viewerId !== undefined && s.hostId === viewerId) return "Yours";
  if (s.myStatus === "accepted") return "Joined";
  if (s.myStatus === "invited") return "Invited";
  return null;
}

/** "Live now", "Starts Oct 14, 6:00 PM" or "Starts when ready". */
export function tournamentWhen(t: { status: string; startsAt: number | null }): string {
  if (t.status === "running") return "In progress";
  if (!t.startsAt) return "Starts when ready";
  return `Starts ${new Date(t.startsAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}
