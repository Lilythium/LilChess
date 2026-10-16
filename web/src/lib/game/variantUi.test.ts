import { describe, expect, it } from "vitest";
import { dropSquares, dropUci, engineSupports, checksLeft, hasStrips, isDropVariant, pocketOf, promotionRoles } from "./variantUi";
import { positionFromFen } from "@lilchess/shared";

describe("variant UI helpers", () => {
  it("offers a king promotion only in Antichess", () => {
    expect(promotionRoles("antichess")).toEqual(["q", "r", "b", "n", "k"]);
    for (const v of ["standard", "chess960", "crazyhouse", "threecheck"] as const) expect(promotionRoles(v)).toEqual(["q", "r", "b", "n"]);
  });

  it("knows which variants need strips, drops and a different engine story", () => {
    expect(isDropVariant("crazyhouse")).toBe(true);
    expect(isDropVariant("standard")).toBe(false);
    expect(hasStrips("crazyhouse") && hasStrips("threecheck")).toBe(true);
    expect(hasStrips("antichess")).toBe(false);
    expect([engineSupports("standard"), engineSupports("chess960"), engineSupports("crazyhouse"), engineSupports("antichess")]).toEqual([true, true, false, false]);
  });

  it("builds drop UCI", () => {
    expect(dropUci("knight", "f3")).toBe("N@f3");
    expect(dropUci("pawn", "e4")).toBe("P@e4");
  });

  it("lists a pocket in display order and omits empty slots", () => {
    const pos = positionFromFen("4k3/8/8/8/8/8/8/4K3[PPNq] w - - 0 1", "crazyhouse");
    expect(pocketOf(pos, "white")).toEqual([{ role: "knight", count: 1 }, { role: "pawn", count: 2 }]);
    expect(pocketOf(pos, "black")).toEqual([{ role: "queen", count: 1 }]);
    expect(pocketOf(positionFromFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1", "standard"), "white")).toEqual([]);
  });

  it("finds legal drop squares: empty squares only, no pawns on the back ranks, none for the side not on move", () => {
    const pos = positionFromFen("4k3/8/8/8/8/8/8/4K3[PN] w - - 0 1", "crazyhouse");
    const pawn = dropSquares(pos, "pawn");
    expect(pawn).toContain("e4");
    expect(pawn).not.toContain("e1"); // occupied
    expect(pawn.some((s) => s.endsWith("1") || s.endsWith("8"))).toBe(false); // never on rank 1 or 8
    expect(dropSquares(pos, "knight")).toContain("a1");
    expect(dropSquares(pos, "queen")).toEqual([]); // not in the pocket
  });

  it("reports Three-check counters", () => {
    expect(checksLeft(positionFromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 3+2 0 1", "threecheck"))).toEqual({ white: 3, black: 2 });
    expect(checksLeft(positionFromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "standard"))).toBeNull();
  });
});
