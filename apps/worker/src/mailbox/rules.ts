/**
 * Filters / rules engine (pure matching). The IMAP write-back that applies
 * the resulting actions lives in sync.ts so it can share the already-open
 * mailbox connection and stay in step with the flag-resync (a rule that
 * sets \Seen on the server is read straight back as read — no fight).
 *
 * Rules run on NEW inbound INBOX mail only (never on the first backfill and
 * never on Sent), which mirrors how Gmail/Outlook filters behave.
 */

export type RuleField = "from" | "to" | "subject" | "has_attachment";
export type RuleOp = "contains" | "not_contains" | "equals" | "is_true" | "is_false";

export type RuleCondition = { field: RuleField; op: RuleOp; value?: string };
export type RuleConditions = { match: "all" | "any"; rules: RuleCondition[] };

export type RuleAction =
  | { type: "mark_read" }
  | { type: "star" }
  | { type: "trash" }
  | { type: "move"; folderId: string };

export type StoredRule = {
  id: string;
  enabled: boolean;
  position: number;
  stopProcessing: boolean;
  conditions: RuleConditions;
  actions: RuleAction[];
};

type Addr = { name?: string; address: string };

export type MailForRules = {
  from: Addr[];
  to: Addr[];
  cc: Addr[];
  subject: string | null;
  hasAttachments: boolean;
};

/** "Full Name <addr@x>, other@y" lowercased — matched by substring/equality. */
function addrText(list: Addr[]): string {
  return list
    .map((a) => `${a.name ?? ""} ${a.address}`.trim())
    .join(", ")
    .toLowerCase();
}

/** Substring haystack (name + address) for `contains`/`not_contains`. */
function fieldText(field: RuleField, msg: MailForRules): string {
  switch (field) {
    case "from":
      return addrText(msg.from);
    case "to":
      return `${addrText(msg.to)}, ${addrText(msg.cc)}`;
    case "subject":
      return (msg.subject ?? "").toLowerCase();
    default:
      return "";
  }
}

/** Bare addresses for exact `equals` matching. */
function fieldAddrs(field: RuleField, msg: MailForRules): string[] {
  const src = field === "from" ? msg.from : field === "to" ? [...msg.to, ...msg.cc] : [];
  return src.map((a) => a.address.toLowerCase());
}

function matchOne(cond: RuleCondition, msg: MailForRules): boolean {
  if (cond.field === "has_attachment") {
    return cond.op === "is_false" ? !msg.hasAttachments : msg.hasAttachments;
  }
  const needle = (cond.value ?? "").trim().toLowerCase();
  if (!needle) return false;
  switch (cond.op) {
    case "contains":
      return fieldText(cond.field, msg).includes(needle);
    case "not_contains":
      return !fieldText(cond.field, msg).includes(needle);
    case "equals":
      return cond.field === "subject"
        ? (msg.subject ?? "").trim().toLowerCase() === needle
        : fieldAddrs(cond.field, msg).includes(needle);
    default:
      return false;
  }
}

export function matchConditions(conds: RuleConditions, msg: MailForRules): boolean {
  const rules = conds?.rules ?? [];
  if (rules.length === 0) return false;
  return conds.match === "any" ? rules.some((r) => matchOne(r, msg)) : rules.every((r) => matchOne(r, msg));
}

/**
 * Runs the enabled rules in `position` order and returns the merged set of
 * actions to apply. A matching rule with stopProcessing halts the chain.
 * Flag actions dedupe; the first `move`/`trash` wins (a message has one home).
 */
export function actionsForMessage(
  rules: StoredRule[],
  msg: MailForRules,
): { actions: RuleAction[]; matchedRuleIds: string[] } {
  const ordered = [...rules].filter((r) => r.enabled).sort((a, b) => a.position - b.position);
  const out: RuleAction[] = [];
  const matchedRuleIds: string[] = [];
  let hasMove = false;
  const flags = new Set<string>();
  for (const rule of ordered) {
    let matched = false;
    try {
      matched = matchConditions(rule.conditions, msg);
    } catch {
      matched = false;
    }
    if (!matched) continue;
    matchedRuleIds.push(rule.id);
    for (const a of rule.actions ?? []) {
      if (a.type === "mark_read" || a.type === "star") {
        if (!flags.has(a.type)) {
          flags.add(a.type);
          out.push(a);
        }
      } else if ((a.type === "move" || a.type === "trash") && !hasMove) {
        hasMove = true;
        out.push(a);
      }
    }
    if (rule.stopProcessing) break;
  }
  return { actions: out, matchedRuleIds };
}
