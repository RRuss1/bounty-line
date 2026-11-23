/**
 * Bounty terms (spec 5.4c, the Expand section of Set Bounty): how many kills the reward buys,
 * how it pays out, bonuses and restrictions. Pure rules here; claims and payments use them in
 * kills.ts and payments.ts.
 *
 *  - Each kill (payout 0): the reward is split evenly over the kills (the last kill takes the
 *    rounding), and every approved kill is paid on its own, by any hunter.
 *  - All or nothing (payout 1): one hunter must land every kill; they're paid the whole reward
 *    when their last one is approved.
 *  - Bonuses are extra gold on top, each paid at most once per bounty: on the first approved
 *    kill that earns it (all or nothing: on any of the winner's kills).
 *  - Restrictions: a kill that breaks one doesn't count.
 */
import { type BountyTerm, FACT, type KillClaim, TERM } from "./codec";
import { className, gold, zoneName } from "./wow";

/** The terms columns of a bounty row (rows are read with SELECT *). */
export interface TermsRow {
  reward_gold: number;
  kills_wanted?: number | null;
  payout_mode?: number | null;
  terms_json?: string | null;
}

export function termsOf(b: TermsRow): BountyTerm[] {
  try {
    const t = JSON.parse(b.terms_json ?? "[]") as BountyTerm[];
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}
export const killsWanted = (b: TermsRow) => Math.max(1, b.kills_wanted ?? 1);
export const allOrNothing = (b: TermsRow) => (b.payout_mode ?? 0) === 1;
/** More than one kill: claims don't lock the bounty while officers review one. */
export const isMultiKill = (b: TermsRow) => killsWanted(b) > 1;
/** Anything beyond a plain one-kill bounty: no Add to Bounty, per-kill payments. */
export const isExpanded = (b: TermsRow) => isMultiKill(b) || termsOf(b).length > 0;

export const bonusesOf = (terms: BountyTerm[]) => terms.filter((t) => t.kind < 64);
export const bonusTotal = (terms: BountyTerm[]) => bonusesOf(terms).reduce((n, t) => n + t.gold, 0);

/** The base share of kill number `index` (1-based) of a bounty paid per kill. */
export function killShare(reward: number, kills: number, index: number): number {
  const each = Math.floor(reward / kills);
  return index >= kills ? reward - each * (kills - 1) : each;
}

const plural = (cls: string) => (cls.endsWith("s") ? cls : `${cls}s`);

/** One term in plain words, for the poster, the claim and the pack tooltip. */
export function describeTerm(t: BountyTerm): string {
  const where = () => zoneName(t.value) ?? `map ${t.value}`;
  switch (t.kind) {
    case TERM.zoneBonus:
      return `+${gold(t.gold)} if killed in ${where()}`;
    case TERM.classBonus:
      return `+${gold(t.gold)} if the hunter is a ${className(t.value)}`;
    case TERM.soloBonus:
      return `+${gold(t.gold)} if the hunter isn't in a group`;
    case TERM.underdogBonus:
      return `+${gold(t.gold)} if the hunter is a lower level than the target`;
    case TERM.rushBonus:
      return `+${gold(t.gold)} if killed within ${t.value}h of the bounty`;
    case TERM.insultBonus:
      return `+${gold(t.gold)} for a /lol within 10 seconds of the kill`;
    case TERM.zoneOnly:
      return `Only in ${where()}`;
    case TERM.classOnly:
      return `${plural(className(t.value))} only`;
    case TERM.soloOnly:
      return "Solo only (no group)";
    default:
      return `Term ${t.kind}`;
  }
}

/** "900g for 3 kills (300g each)" / "900g for 3 kills by one hunter" / "500g". */
export function rewardText(b: TermsRow): string {
  const n = killsWanted(b);
  if (n === 1) return gold(b.reward_gold);
  if (allOrNothing(b)) return `${gold(b.reward_gold)} for ${n} kills by one hunter`;
  const each = Math.floor(b.reward_gold / n);
  const even = each * n === b.reward_gold;
  return `${gold(b.reward_gold)} for ${n} kills (${even ? "" : "about "}${gold(each)} each)`;
}

/** What the hunter's addon knew at the kill (K schema 3). Older addons know nothing. */
export interface KillFacts {
  known: boolean;
  classId: number;
  level: number;
  victimLevel: number;
  solo: boolean;
  insult: boolean;
}

export function factsOf(k: KillClaim): KillFacts {
  const known = k.schema >= 3 && k.facts !== undefined;
  const facts = k.facts ?? 0;
  return {
    known,
    classId: k.killerClassID ?? 0,
    level: k.killerLevel ?? 0,
    victimLevel: k.victimLevel ?? 0,
    solo: known && (facts & FACT.solo) !== 0,
    insult: known && (facts & FACT.insult) !== 0,
  };
}

export interface KillContext {
  mapId: number;
  killedAt: number;
  /** When the bounty was made in game (bountyMadeAt). */
  madeAt: number;
  facts: KillFacts;
}

/**
 * Restrictions this kill breaks ("broken": it doesn't count) and ones it can't show (an older
 * addon sent no facts: the officers decide from the screenshot).
 */
export function checkRestrictions(terms: BountyTerm[], c: KillContext): { broken: string[]; unknown: string[] } {
  const broken: string[] = [];
  const unknown: string[] = [];
  for (const t of terms) {
    if (t.kind === TERM.zoneOnly && c.mapId !== t.value) broken.push(describeTerm(t));
    if (t.kind === TERM.classOnly) {
      if (!c.facts.known || !c.facts.classId) unknown.push(describeTerm(t));
      else if (c.facts.classId !== t.value) broken.push(describeTerm(t));
    }
    if (t.kind === TERM.soloOnly) {
      if (!c.facts.known) unknown.push(describeTerm(t));
      else if (!c.facts.solo) broken.push(describeTerm(t));
    }
  }
  return { broken, unknown };
}

/** The bonuses this kill meets (before "once per bounty"). */
export function bonusesMet(terms: BountyTerm[], c: KillContext): BountyTerm[] {
  const f = c.facts;
  return bonusesOf(terms).filter((t) => {
    switch (t.kind) {
      case TERM.zoneBonus:
        return c.mapId === t.value;
      case TERM.classBonus:
        return f.known && f.classId === t.value;
      case TERM.soloBonus:
        return f.solo;
      case TERM.underdogBonus:
        return f.known && f.level > 0 && f.victimLevel > 0 && f.level < f.victimLevel;
      case TERM.rushBonus:
        return c.killedAt <= c.madeAt + t.value * 3600;
      case TERM.insultBonus:
        return f.insult;
      default:
        return false;
    }
  });
}

/** Stored per kill in checks_json, so approval can work the bonuses out later. */
export function factsFromChecks(checksJson: string | null): KillFacts {
  try {
    const f = (JSON.parse(checksJson ?? "{}") as { facts?: KillFacts }).facts;
    if (f) return f;
  } catch {
    /* fall through */
  }
  return { known: false, classId: 0, level: 0, victimLevel: 0, solo: false, insult: false };
}
