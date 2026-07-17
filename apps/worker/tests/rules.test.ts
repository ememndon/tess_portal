import { describe, expect, it } from "vitest";
import { actionsForMessage, matchConditions, type MailForRules, type StoredRule } from "../src/mailbox/rules";

/**
 * Filter-rule matching (pure). Conditions evaluate against envelope fields;
 * actions merge across matching rules in position order, with stopProcessing
 * halting the chain and one home (move/trash) winning.
 */

const msg: MailForRules = {
  from: [{ name: "Greenhouse", address: "no-reply@greenhouse.io" }],
  to: [{ address: "me@job.dev" }],
  cc: [],
  subject: "Application received — Software Engineer",
  hasAttachments: false,
};

function rule(partial: Partial<StoredRule>): StoredRule {
  return {
    id: partial.id ?? "r",
    enabled: partial.enabled ?? true,
    position: partial.position ?? 100,
    stopProcessing: partial.stopProcessing ?? true,
    conditions: partial.conditions ?? { match: "all", rules: [] },
    actions: partial.actions ?? [],
  };
}

describe("matchConditions", () => {
  it("matches contains on from", () => {
    expect(matchConditions({ match: "all", rules: [{ field: "from", op: "contains", value: "greenhouse" }] }, msg)).toBe(true);
  });
  it("matches equals on a bare address", () => {
    expect(
      matchConditions({ match: "all", rules: [{ field: "from", op: "equals", value: "no-reply@greenhouse.io" }] }, msg),
    ).toBe(true);
    expect(matchConditions({ match: "all", rules: [{ field: "from", op: "equals", value: "greenhouse" }] }, msg)).toBe(false);
  });
  it("honours all vs any", () => {
    const rules = [
      { field: "subject", op: "contains", value: "software engineer" },
      { field: "from", op: "contains", value: "nope" },
    ] as const;
    expect(matchConditions({ match: "all", rules: [...rules] }, msg)).toBe(false);
    expect(matchConditions({ match: "any", rules: [...rules] }, msg)).toBe(true);
  });
  it("not_contains and has_attachment", () => {
    expect(matchConditions({ match: "all", rules: [{ field: "subject", op: "not_contains", value: "invoice" }] }, msg)).toBe(true);
    expect(matchConditions({ match: "all", rules: [{ field: "has_attachment", op: "is_false" }] }, msg)).toBe(true);
    expect(matchConditions({ match: "all", rules: [{ field: "has_attachment", op: "is_true" }] }, msg)).toBe(false);
  });
  it("empty conditions never match", () => {
    expect(matchConditions({ match: "all", rules: [] }, msg)).toBe(false);
  });
});

describe("actionsForMessage", () => {
  it("collects actions from a matching rule", () => {
    const r = rule({
      conditions: { match: "all", rules: [{ field: "from", op: "contains", value: "greenhouse" }] },
      actions: [{ type: "mark_read" }, { type: "star" }],
    });
    const { actions, matchedRuleIds } = actionsForMessage([r], msg);
    expect(matchedRuleIds).toEqual(["r"]);
    expect(actions).toEqual([{ type: "mark_read" }, { type: "star" }]);
  });

  it("skips disabled rules", () => {
    const r = rule({
      enabled: false,
      conditions: { match: "all", rules: [{ field: "from", op: "contains", value: "greenhouse" }] },
      actions: [{ type: "star" }],
    });
    expect(actionsForMessage([r], msg).actions).toEqual([]);
  });

  it("stopProcessing halts later rules", () => {
    const first = rule({
      id: "a",
      position: 1,
      stopProcessing: true,
      conditions: { match: "all", rules: [{ field: "from", op: "contains", value: "greenhouse" }] },
      actions: [{ type: "mark_read" }],
    });
    const second = rule({
      id: "b",
      position: 2,
      conditions: { match: "all", rules: [{ field: "subject", op: "contains", value: "application" }] },
      actions: [{ type: "star" }],
    });
    const { actions, matchedRuleIds } = actionsForMessage([second, first], msg);
    expect(matchedRuleIds).toEqual(["a"]);
    expect(actions).toEqual([{ type: "mark_read" }]);
  });

  it("first move wins, flags dedupe", () => {
    const first = rule({
      id: "a",
      position: 1,
      stopProcessing: false,
      conditions: { match: "all", rules: [{ field: "from", op: "contains", value: "greenhouse" }] },
      actions: [{ type: "move", folderId: "f1" }, { type: "mark_read" }],
    });
    const second = rule({
      id: "b",
      position: 2,
      conditions: { match: "all", rules: [{ field: "subject", op: "contains", value: "application" }] },
      actions: [{ type: "move", folderId: "f2" }, { type: "mark_read" }],
    });
    const { actions } = actionsForMessage([first, second], msg);
    expect(actions).toEqual([{ type: "move", folderId: "f1" }, { type: "mark_read" }]);
  });
});
