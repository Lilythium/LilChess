import { describe, expect, it } from "vitest";
import { pendingSimuls, simulBadge, tournamentWhen } from "./lobbyEvents";
import type { SimulSummary } from "./simul/types";

const simul = (id: string, over: Partial<SimulSummary> = {}): SimulSummary => ({
  id, name: id, status: "open", mode: "live", variant: "standard", hostId: 1, hostName: "hana",
  initialMs: 300_000, incrementMs: 0, daysPerMove: null, maxPlayers: 8, createdAt: 0, isPublic: true,
  accepted: 0, boardsLeft: 0, boardsToMove: 0, viewerGameId: null, myStatus: null, ...over,
});

describe("pendingSimuls", () => {
  it("orders mine, invitations, then public, and drops duplicates", () => {
    const mine = simul("mine", { hostId: 9 });
    const inv = simul("inv", { myStatus: "invited" });
    const pub = simul("pub");
    const out = pendingSimuls({ hosting: mine, invitations: [inv], open: [pub, simul("inv")] });
    expect(out.map((s) => s.id)).toEqual(["mine", "inv", "pub"]);
  });

  it("skips a hosted simul that is already running, and copes with missing lists", () => {
    expect(pendingSimuls({ hosting: simul("r", { status: "running" }), invitations: [] })).toEqual([]);
    expect(pendingSimuls({ hosting: null, invitations: [] })).toEqual([]);
  });
});

describe("simulBadge", () => {
  it("labels the viewer's relationship", () => {
    expect(simulBadge(simul("a", { hostId: 5 }), 5)).toBe("Yours");
    expect(simulBadge(simul("a", { myStatus: "accepted" }), 5)).toBe("Joined");
    expect(simulBadge(simul("a", { myStatus: "invited" }), 5)).toBe("Invited");
    expect(simulBadge(simul("a"), 5)).toBeNull();
  });
});

describe("tournamentWhen", () => {
  it("describes running, unscheduled and scheduled tournaments", () => {
    expect(tournamentWhen({ status: "running", startsAt: null })).toBe("In progress");
    expect(tournamentWhen({ status: "open", startsAt: null })).toBe("Starts when ready");
    expect(tournamentWhen({ status: "open", startsAt: Date.now() + 86_400_000 })).toMatch(/^Starts /);
  });
});
