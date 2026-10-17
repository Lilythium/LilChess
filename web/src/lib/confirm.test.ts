import { afterEach, describe, expect, it } from "vitest";
import { answerConfirm, askConfirm, subscribeConfirm, type ConfirmRequest } from "./confirm";

describe("askConfirm", () => {
  afterEach(() => answerConfirm(false));

  it("resolves true when confirmed and false when dismissed", async () => {
    const yes = askConfirm("Resign?");
    answerConfirm(true);
    expect(await yes).toBe(true);

    const no = askConfirm("Resign?");
    answerConfirm(false);
    expect(await no).toBe(false);
  });

  it("shows the request to the subscribed dialog and clears it afterwards", async () => {
    const seen: (ConfirmRequest | null)[] = [];
    const unsubscribe = subscribeConfirm((request) => seen.push(request));

    const answer = askConfirm("Delete?", { confirmLabel: "Delete", danger: true });
    expect(seen.at(-1)).toMatchObject({ message: "Delete?", confirmLabel: "Delete", cancelLabel: "Cancel", danger: true });
    answerConfirm(true);
    await answer;
    expect(seen.at(-1)).toBeNull();
    unsubscribe();
  });

  it("cancels the older question when a new one is asked", async () => {
    const first = askConfirm("First?");
    const second = askConfirm("Second?");
    expect(await first).toBe(false);
    answerConfirm(true);
    expect(await second).toBe(true);
  });

  it("ignores an answer when nothing is pending", () => {
    expect(() => answerConfirm(true)).not.toThrow();
  });

  it("hands a late subscriber the question that is already open", async () => {
    const pending = askConfirm("Still there?");
    let seen: ConfirmRequest | null = null;
    const unsubscribe = subscribeConfirm((request) => (seen = request));
    expect(seen).toMatchObject({ message: "Still there?" });
    answerConfirm(true);
    await pending;
    unsubscribe();
  });
});
