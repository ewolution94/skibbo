// Skibbo's bots, at a guild's three ranks (as in Stichle, Stammtisch and Würfle):
//
//   apprentice  a beginner: plays the stock card whenever it fits (a Joker first, when that's all it
//               takes), otherwise the hand's cards that fit, lowest first, then a discard pile's top;
//               spends its Jokers freely; discards its highest card onto an empty pile, else anywhere
//   journeyman  a solid player (the default): looks for the cheapest way to its stock card this turn
//               (the cards it needs in order from its discard piles, its hand, a Joker last), plays on
//               only where it doesn't bring a pile just below the next player's stock card, keeps its
//               Jokers for the stock, and discards by judgement: runs down, twins together, an empty
//               pile kept while it can, nothing buried that's about to fit
//   master      searches every sequence of plays this turn (memoised over the piles and its sources)
//               and values where each ends: stock cards played first, then what it leaves the next
//               players (their stock cards within reach), its partner's chances, its own next turn,
//               its Jokers and its discard piles; decided within MASTER_MS (best found so far after)
//
// A bot sees only its seat's view (rules.mjs → view): its own hand, the stocks' top cards, the discard
// piles, the building piles. So it is honest by construction (tests/bots.test.mjs → "honest"). No
// randomness: the same view always gives the same move. Runs in the page too, for the solo game.

import { PILES, TOP, isWild, listMoves, partnerOf, value } from './rules.mjs';

/** @typedef {import('./rules.mjs').View} View */
/** @typedef {import('./rules.mjs').Move} Move */

/** The ranks, weakest first. */
export const LEVELS = Object.freeze(['apprentice', 'journeyman', 'master']);

/**
 * A master's hard stop in wall-clock time (Stichle's, for the NAS's two slow cores). Its search
 * usually takes a few milliseconds on a laptop; past the stop it plays the best move found so far.
 * SKIBBO_MASTER_MS overrides it.
 */
export const MASTER_MS = Number(globalThis.process?.env?.SKIBBO_MASTER_MS ?? 150);
/**
 * How many positions a master's search may visit: the limit that binds first on a laptop, so a
 * decision doesn't depend on the clock (SKIBBO_MASTER_NODES overrides it).
 */
export const MASTER_NODES = Number(globalThis.process?.env?.SKIBBO_MASTER_NODES ?? 12000);

const now = () => globalThis.performance?.now?.() ?? Date.now();

/**
 * The chance that a fresh hand of five holds the r numbers a pile still needs, Jokers filling the
 * gaps (counted over the deck: 12 of each number, 18 Jokers).
 */
const BRIDGE = [1, 0.65, 0.34, 0.14, 0.045, 0.01, 0];
const bridge = (/** @type {number} */ r) => BRIDGE[Math.min(r, BRIDGE.length - 1)];

/** @param {number[]} cards */
const topOf = (cards) => (cards.length ? cards[cards.length - 1] : null);

/**
 * Every legal move for the seat whose view this is (the same list as rules.mjs → moves(state, seat));
 * empty when it isn't its turn. The page's hints use it too.
 * @param {View} view
 * @returns {Move[]}
 */
export function movesFromView(view) {
  if (view.phase !== 'play' || view.you === null || view.turn !== view.you) return [];
  const mate = partnerOf(view.teams, view.you);
  const owners = mate === null ? [view.you] : [view.you, mate];
  return listMoves({
    hand: view.hand,
    build: view.build.map((b) => b.n),
    sources: owners.map((owner) => {
      const { stockTop, discards } = view.seats[owner];
      return { owner, stockTop, discardTops: discards.map(topOf) };
    }),
  });
}

/**
 * The next move for the seat whose view this is: one play, a discard or the end of the turn. Null
 * when it isn't its turn. A level it doesn't know plays as a journeyman.
 * @param {View} view  @param {{ level?: string }} [o]
 * @returns {Move | null}
 */
export function botMove(view, { level = 'journeyman' } = {}) {
  if (view.phase !== 'play' || view.you === null || view.turn !== view.you) return null;
  if (level === 'apprentice') return apprentice(view);
  if (level === 'master') return master(view);
  return journeyman(view);
}

/**
 * A random legal move, for tools/ladder.mjs and the tests: a random play half the time when there is
 * one, else a random discard (or the end of the turn).
 * @param {View} view  @param {(n: number) => number} randomInt
 * @returns {Move | null}
 */
export function randomMove(view, randomInt) {
  const all = movesFromView(view);
  if (!all.length) return null;
  const plays = all.filter((m) => m.type === 'play');
  const rest = all.filter((m) => m.type !== 'play');
  const pool = plays.length && (!rest.length || randomInt(2) === 0) ? plays : rest;
  return pool[randomInt(pool.length)];
}

/**
 * A repeatable random number generator seeded by a key built from what the seat sees, so the same
 * view always gives the same move (Stammtisch's).
 * @param {string} key
 */
function seeded(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- what every rank reads off the table ----------------------------------------------------------

/**
 * A seat's reach: the stock cards it may play (its own, and with teams its partner's) and the discard
 * piles it may play from, as numbers (0 a Joker).
 * @typedef {{ seat: number, stocks: number[], stacks: number[][] }} Reach
 */

/**
 * The table as the bots weigh it: the piles' lengths, who plays after us (opponents and partner, the
 * nearest first) and what each of them can reach.
 * @param {View} v
 */
function read(v) {
  const me = /** @type {number} */ (v.you);
  const mate = partnerOf(v.teams, me);
  const piles = v.build.map((b) => b.n);
  /** @param {number} seat @returns {Reach} */
  const reach = (seat) => {
    const p = partnerOf(v.teams, seat);
    const seats = p === null ? [seat] : [seat, p];
    return {
      seat,
      stocks: seats.flatMap((s) => (v.seats[s].stockTop === null ? [] : [value(v.seats[s].stockTop)])),
      stacks: seats.flatMap((s) => v.seats[s].discards.map((d) => d.map(value))),
    };
  };
  /** The others in the order they play after us: k is how many turns away. */
  const after = Array.from({ length: v.players - 1 }, (_, i) => {
    const seat = (me + 1 + i) % v.players;
    return { ...reach(seat), k: i + 1, mate: seat === mate };
  });
  return { v, me, mate, piles, after, next: after.find((o) => !o.mate) ?? null };
}

/**
 * How many of the numbers a pile of `L` cards needs before a card `sv` fits it are missing from the
 * discard piles' cards (`stacks`, bottom to top, the first `ptr[k]` of each; whole piles, as each top
 * played shows the next), and from the hand counts `hand` when given (0: Jokers). 7 when it's too far.
 * @param {number} L  @param {number} sv  @param {number[][]} stacks  @param {ArrayLike<number> | null} [ptr]
 * @param {ArrayLike<number> | null} [hand]
 */
function gapFor(L, sv, stacks, ptr = null, hand = null) {
  const steps = L <= sv - 1 ? sv - 1 - L : TOP - L + sv - 1;
  if (!steps) return 0;
  if (steps > 6) return 7;
  const at = stacks.map((s, k) => (ptr ? ptr[k] : s.length));
  const held = hand ? Array.from(hand) : null;
  let missing = 0;
  for (let i = 1; i <= steps; i++) {
    const w = ((L + i - 1) % TOP) + 1;
    let hit = -1;
    for (let k = 0; k < stacks.length && hit < 0; k++) if (at[k] && stacks[k][at[k] - 1] === w) hit = k;
    if (hit < 0 && held && held[w] > 0) {
      held[w] -= 1;
      continue;
    }
    for (let k = 0; k < stacks.length && hit < 0; k++) if (at[k] && stacks[k][at[k] - 1] === 0) hit = k;
    if (hit >= 0) at[hit] -= 1;
    else if (held && held[0] > 0) held[0] -= 1;
    else missing += 1;
  }
  return missing;
}

/**
 * The chance a seat with this reach plays one of its stock cards on its next turn, were the piles as
 * they are now: a Joker on top always plays; otherwise the nearest pile and what its discard piles
 * hold decide, the rest left to a fresh hand.
 * @param {ArrayLike<number>} piles  @param {Reach} r
 */
function chanceOf(piles, r) {
  let best = 0;
  for (const sv of r.stocks) {
    if (sv === 0) return 1;
    for (let i = 0; i < piles.length; i++) {
      const c = bridge(gapFor(piles[i], sv, r.stacks));
      if (c > best) best = c;
    }
  }
  return best;
}

/**
 * The judgement of a discard: laying the number `c` (0 a Joker) on a discard pile holding `stack`
 * (numbers, bottom to top, the first `n`). Higher is better: a run down (a card on one a number
 * higher) or twins together; never on a Joker; an empty pile kept while it can (above all the last
 * one); nothing buried that's about to fit a building pile; the numbers just below our stock card kept
 * in hand; Jokers kept in hand.
 * @param {number} c  @param {number[]} stack  @param {number} n  @param {ArrayLike<number>} piles
 * @param {number | null} sv  our stock card's number (null: none, or not known yet)
 * @param {number} empty  how many of our discard piles are empty  @param {boolean} twin  we hold another `c`
 */
function discardScore(c, stack, n, piles, sv, empty, twin) {
  let s = 0.08 * c;
  if (c === 0) s -= 6;
  const top = n ? stack[n - 1] : null;
  if (top === null) s -= empty > 1 ? 1 : 3;
  else if (top === 0) s -= 5;
  else if (c === 0) s -= 1;
  else if (c === top - 1) s += 3;
  else if (c === top) s += 2;
  else if (c < top) s += 1 - 0.2 * (top - c - 1);
  else s -= 2 + 0.3 * (c - top);
  if (top !== null && top !== 0 && c !== top - 1) {
    for (let i = 0; i < piles.length; i++) {
      if (top === piles[i] + 1 || top === piles[i] + 2) {
        s -= 2.5;
        break;
      }
    }
  }
  if (sv && c && c < sv && c >= sv - 2) s -= 1.5;
  if (twin) s += 0.5;
  return s;
}

/**
 * The journeyman's discard: the best hand card and pile by discardScore (the master weighs its
 * discards by it too); the end of the turn with an empty hand.
 * @param {View} v  @param {ArrayLike<number>} piles
 * @returns {Move}
 */
function closing(v, piles) {
  const me = /** @type {number} */ (v.you);
  if (!v.hand.length) return { type: 'end' };
  const stacks = v.seats[me].discards.map((d) => d.map(value));
  const empty = stacks.filter((d) => !d.length).length;
  const top = v.seats[me].stockTop;
  const sv = top === null ? null : value(top);
  let best = { card: v.hand[0], slot: 0, s: -Infinity };
  for (const card of v.hand) {
    const c = value(card);
    const twin = v.hand.some((o) => o !== card && value(o) === c);
    for (let slot = 0; slot < PILES; slot++) {
      const s = discardScore(c, stacks[slot], stacks[slot].length, piles, sv, empty, twin);
      if (s > best.s + 1e-9) best = { card, slot, s };
    }
  }
  return { type: 'discard', card: best.card, slot: best.slot };
}

// ---- apprentice -----------------------------------------------------------------------------------

/** @param {View} v @returns {Move} */
function apprentice(v) {
  const me = /** @type {number} */ (v.you);
  const plays = movesFromView(v).filter((m) => m.type === 'play');
  const piles = v.build.map((b) => b.n);
  // Its own stock card, then its partner's, wherever it fits.
  const stock = plays.find((m) => m.from === 'stock' && m.owner === me) ?? plays.find((m) => m.from === 'stock');
  if (stock) return stock;
  // A Joker onto a pile two below the stock card, so the stock card follows.
  const top = v.seats[me].stockTop;
  const joker = v.hand.find(isWild);
  if (top !== null && !isWild(top) && joker !== undefined) {
    const pile = piles.indexOf(value(top) - 2);
    if (pile >= 0) return { type: 'play', card: joker, pile, from: 'hand' };
  }
  // The hand's lowest number that fits, then a discard pile's top, then a Joker anywhere.
  const number = plays.find((m) => m.from === 'hand' && !isWild(m.card));
  if (number) return number;
  const thrown = plays.find((m) => m.from === 'discard' && !isWild(m.card));
  if (thrown) return thrown;
  const wild = plays.find((m) => m.from === 'hand');
  if (wild) return wild;
  if (!v.hand.length) return { type: 'end' };
  // Its highest card (a Joker only when that's all it holds), onto the first empty pile, else any.
  const card = v.hand.reduce((a, b) => (value(b) > value(a) || isWild(a) ? b : a));
  const discards = v.seats[me].discards;
  let slot = discards.findIndex((d) => !d.length);
  if (slot < 0) slot = Math.floor(seeded(`apprentice|${me}|${v.turnNo}|${v.hand.join(',')}`)() * PILES);
  return { type: 'discard', card, slot };
}

// ---- journeyman -----------------------------------------------------------------------------------

/** @param {View} v @returns {Move} */
function journeyman(v) {
  const t = read(v);
  return stockPath(t) ?? safePlay(t) ?? stranded(t) ?? closing(v, t.piles);
}

/**
 * One play of a way to the stock: a hand card, a stock's top, or a discard pile's top.
 * @typedef {{ kind: 'hand', id: number } | { kind: 'stock', id: number, owner: number }
 *   | { kind: 'discard', id: number, owner: number, slot: number }} Step
 * @typedef {{ cost: number, len: number, risk: number, move: Move }} Way
 */

/** A step as the move onto `pile`. @param {Step} s @param {number} pile @returns {Move} */
function stepMove(s, pile) {
  if (s.kind === 'hand') return { type: 'play', card: s.id, pile, from: 'hand' };
  if (s.kind === 'stock') return { type: 'play', card: s.id, pile, from: 'stock', owner: s.owner };
  return { type: 'play', card: s.id, pile, from: 'discard', slot: s.slot, owner: s.owner };
}

/**
 * Our discard piles (and with teams our partner's), as ids and numbers, with whose they are.
 * @param {View} v  @param {number[]} owners
 */
const stacksOf = (v, owners) =>
  owners.flatMap((owner) => v.seats[owner].discards.map((ids, slot) => ({ owner, slot, ids, vals: ids.map(value) })));

/**
 * The first play of the cheapest way to a stock card this turn (ours, or with teams our partner's),
 * or null when there's none: on one building pile, every number it needs in order, each from a
 * discard pile's top (free), the other stock (a bonus), the hand (a card spent) or a Joker (dear).
 * Ties go to the shorter way, then the one leaving the next player less.
 * @param {ReturnType<typeof read>} t
 * @returns {Move | null}
 */
function stockPath(t) {
  const { v, me, mate, piles } = t;
  const owners = mate === null ? [me] : [me, mate];
  const stacks = stacksOf(v, owners);
  /** @type {{ way: Way | null }} */
  const pick = { way: null };
  const consider = (/** @type {Way} */ c) => {
    const b = pick.way;
    const tie = b && Math.abs(c.cost - b.cost) < 1e-9;
    const shorter = tie && (c.len < b.len || (c.len === b.len && c.risk < b.risk - 1e-9));
    if (!b || c.cost < b.cost - 1e-9 || shorter) pick.way = c;
  };
  for (const goal of owners) {
    const gid = v.seats[goal].stockTop;
    if (gid === null) continue;
    const gv = value(gid);
    /** @type {Step} */
    const target = { kind: 'stock', id: gid, owner: goal };
    const other = owners.find((o) => o !== goal);
    const otherId = other === undefined ? null : v.seats[other].stockTop;
    /** @type {Step | null} */
    const bonus = other === undefined || otherId === null ? null : { kind: 'stock', id: otherId, owner: other };
    for (let pile = 0; pile < PILES; pile++) {
      const L = piles[pile];
      if (piles.indexOf(L) !== pile) continue;
      const risk = riskAfter(t, pile, gv === 0 ? L + 1 : gv);
      if (gv === 0) {
        consider({ cost: 0, len: 0, risk, move: stepMove(target, pile) });
        continue;
      }
      const found = chain(v, stacks, L, gv, bonus);
      if (!found) continue;
      const move = stepMove(found.first ?? target, pile);
      consider({ cost: found.cost + (goal === me ? 0 : 0.01), len: found.len, risk, move });
    }
  }
  return pick.way ? pick.way.move : null;
}

/**
 * The cheapest way to bring a pile of `L` to `gv - 1` (a small search over the sources' order), past
 * 12 and round again when it must: its cost and its first step (null: the pile is there already), or
 * null when there's no way.
 * @param {View} v  @param {ReturnType<typeof stacksOf>} stacks  @param {number} L  @param {number} gv
 * @param {Step | null} other  the other stock's top, when it may help on the way
 * @returns {{ cost: number, len: number, first: Step | null } | null}
 */
function chain(v, stacks, L, gv, other) {
  const steps = L <= gv - 1 ? gv - 1 - L : TOP - L + gv - 1;
  /** The hand's ids per number (0: Jokers), lowest first. @type {number[][]} */
  const hand = Array.from({ length: TOP + 1 }, () => []);
  for (const id of v.hand) hand[value(id)].push(id);
  const used = hand.map(() => 0);
  const ptr = stacks.map((s) => s.ids.length);
  let otherUsed = false;
  /** @type {Step[]} */
  const path = [];
  /** @type {{ best: { cost: number, len: number, first: Step | null } | null }} */
  const found = { best: null };
  let budget = 4000;
  const dfs = (/** @type {number} */ i, /** @type {number} */ cost) => {
    if (found.best && cost >= found.best.cost) return;
    if (budget-- <= 0) return;
    if (i > steps) {
      found.best = { cost, len: steps, first: path[0] ?? null };
      return;
    }
    const w = ((L + i - 1) % TOP) + 1;
    const step = (/** @type {Step} */ s, /** @type {number} */ c) => {
      path.push(s);
      dfs(i + 1, cost + c);
      path.pop();
    };
    /** Each discard pile whose top is `want`, played (its next card showing) at cost `c`. */
    const fromStacks = (/** @type {number} */ want, /** @type {number} */ c) => {
      for (let k = 0; k < stacks.length; k++) {
        if (!ptr[k] || stacks[k].vals[ptr[k] - 1] !== want) continue;
        ptr[k] -= 1;
        step({ kind: 'discard', id: stacks[k].ids[ptr[k]], owner: stacks[k].owner, slot: stacks[k].slot }, c);
        ptr[k] += 1;
      }
    };
    /** The hand's card `want`, at cost `c`. */
    const fromHand = (/** @type {number} */ want, /** @type {number} */ c) => {
      if (used[want] >= hand[want].length) return;
      used[want] += 1;
      step({ kind: 'hand', id: hand[want][used[want] - 1] }, c);
      used[want] -= 1;
    };
    fromStacks(w, 0);
    if (other && !otherUsed && value(other.id) === w) {
      otherUsed = true;
      step(other, -3);
      otherUsed = false;
    }
    fromHand(w, 1);
    fromStacks(0, 3);
    fromHand(0, 4);
  };
  dfs(1, 0);
  return found.best;
}

/**
 * What a pile at `len` cards leaves the next opponent: 1 when it's just below their stock card.
 * @param {ReturnType<typeof read>} t  @param {number} pile  @param {number} len
 */
function riskAfter(t, pile, len) {
  if (!t.next) return 0;
  const piles = [...t.piles];
  piles[pile] = len >= TOP ? 0 : len;
  return t.next.stocks.some((sv) => sv > 0 && piles.includes(sv - 1)) ? 1 : 0;
}

/**
 * A play that does no harm, when no stock card is within reach: never a Joker, never a pile brought
 * just below the next opponent's stock card. A play that takes such a pile away from them comes
 * first, then the discard piles' tops (ours before our partner's), then the hand, lowest first.
 * @param {ReturnType<typeof read>} t
 * @returns {Move | null}
 */
function safePlay(t) {
  const { v, me, piles, next } = t;
  const danger = (/** @type {number} */ len) => Boolean(next && next.stocks.some((sv) => sv > 0 && len === sv - 1));
  /** @type {Move | null} */
  let best = null;
  let bestScore = -Infinity;
  for (const m of movesFromView(v)) {
    if (m.type !== 'play' || m.from === 'stock' || isWild(m.card)) continue;
    const L = piles[m.pile];
    if (danger((L + 1) % TOP)) continue;
    let s = -0.1 * value(m.card);
    if (danger(L)) s += 10;
    if (m.from === 'discard') s += m.owner === me ? 5 : 3;
    if (s > bestScore + 1e-9) {
      best = m;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Nothing in hand and nothing to draw: any play beats passing, a Joker too (a finished pile refills
 * the hand). One that finishes a pile first, then one that leaves the next player nothing.
 * @param {ReturnType<typeof read>} t
 * @returns {Move | null}
 */
function stranded(t) {
  const { v, piles } = t;
  if (v.hand.length || v.draw + v.done > 0) return null;
  /** @type {Move | null} */
  let best = null;
  let bestScore = -Infinity;
  for (const m of movesFromView(v)) {
    if (m.type !== 'play') continue;
    const s = (piles[m.pile] === TOP - 1 ? 2 : 0) - riskAfter(t, m.pile, piles[m.pile] + 1);
    if (s > bestScore) {
      best = m;
      bestScore = s;
    }
  }
  return best;
}

// ---- master ---------------------------------------------------------------------------------------
//
// A depth-first search over everything the turn can still do, memoised on the position (the piles'
// lengths, sorted, as the piles are alike; the hand's numbers; how far each discard pile is played
// down; which stock cards are played). Every position may end the turn there (its value: where it
// leaves the table, with the best discard), or play on. Playing a stock card earns STOCK and shows the
// next one, unknown to the search: it values the chance that it fits and plays on without it. An
// emptied hand draws five unknown cards: REFILL, and the search stops there (the bot looks again).
//
// The weights were set with tools/ladder.mjs and longer runs at two, four and six players and with
// teams (2026-10-20): playing hand cards and keeping Jokers mattered most; weighing every opponent's
// chances alike made the master too stingy at four (it lost to the journeyman there), weighing them by
// the race (who's closest to winning) made it clearly the best.

/** What a stock card played is worth; everything else is measured against it. */
const STOCK = 100;
const WIN = 1e6;
/** Five fresh cards mid-turn. */
const REFILL = 14;
/**
 * An opponent's chance to play a stock card costs us their side's share of the odds against us in the
 * race, times RACE (each side's odds: e^(−RACE_K × its stock cards left), a team's both stocks). The
 * next player counts fully, later ones less: the piles will have moved by their turn.
 */
const RACE = 0.4;
const RACE_K = 0.15;
const LATER = [1, 0.3, 0.1, 0.05, 0.05];
/** A partner's chance to play a stock card. */
const MATE = 30;
/** Our own chance next turn (the piles will have moved by then: worth little). */
const OWN = 8;
/** A Joker kept, a hand card played (one more fresh card next turn), a discard pile's card played. */
const JOKER = 25;
const HAND_CARD = 4;
const THROWN = 2.5;
/** After a stock card, the chance the next one fits at once, as a share of a stock card. */
const NEXT = 0.6;
/** A whisker per play, so the shorter of two equal ways wins. */
const STEP = 0.01;

const ABORT = Symbol('abort');

/** @param {View} v @returns {Move} */
function master(v) {
  const fallback = journeyman(v);
  const until = now() + MASTER_MS;
  const found = search(read(v), fallback, until);
  return found ?? fallback;
}

/**
 * The master's search for the seat in `t`: the best first move, or null when it ran out of time or
 * positions before the journeyman's choice was weighed.
 * @param {ReturnType<typeof read>} t  @param {Move} prefer  the journeyman's move, weighed first
 * @param {number} until
 * @returns {Move | null}
 */
function search(t, prefer, until) {
  const { v, me, mate } = t;
  const owners = mate === null ? [me] : [me, mate];
  const piles = Int8Array.from(t.piles);
  const hand = new Int8Array(TOP + 1);
  for (const id of v.hand) hand[value(id)] += 1;
  let handN = v.hand.length;
  const hand0 = handN;
  // Our discard piles (and our partner's): numbers and ids, and how far each is played down.
  const stacks = stacksOf(v, owners);
  const vals = stacks.map((s) => s.vals);
  const ptr = Int16Array.from(stacks.map((s) => s.ids.length));
  const ptr0 = Int16Array.from(ptr);
  const own = stacks.slice(0, PILES).map((s) => s.vals);
  // The stocks we may play: their top's number; played: -1 (the next one unknown).
  const stockIds = owners.map((o) => v.seats[o].stockTop);
  const stockVal = Int8Array.from(stockIds.map((id) => (id === null ? -2 : value(id))));
  const stockLeft = owners.map((o) => v.seats[o].stock);
  const left = [...stockLeft];
  let drawable = v.draw + v.done > 0;
  // The others' reach does not change while we play, but our partner's discard piles may.
  const opponents = t.after.filter((o) => !o.mate);
  // The race: each side's odds by its stock cards left, and what each opponent's chance costs us.
  const sideOf = (/** @type {number} */ seat) => {
    const p = partnerOf(v.teams, seat);
    return v.seats[seat].stock + (p === null ? 0 : v.seats[p].stock);
  };
  const mine = Math.exp(-RACE_K * sideOf(me));
  const theirs = opponents.map((o) => Math.exp(-RACE_K * sideOf(o.seat)));
  // With teams each opposing side sits at the table twice: half a share per seat.
  const per = v.teams ? 0.5 : 1;
  const total = mine + per * theirs.reduce((a, b) => a + b, 0);
  const against = 1 - mine / total;
  const later = (/** @type {number} */ k) => LATER[Math.min(k - 1, LATER.length - 1)];
  const weight = opponents.map((o, i) => ((STOCK * RACE * per * theirs[i]) / total / against) * later(o.k));
  const mateInfo = t.after.find((o) => o.mate) ?? null;
  const threatMemo = new Map();

  /** What the opponents' chances cost us with the piles as they are. */
  const threat = () => {
    const sorted = [...piles].sort((a, b) => a - b).join(',');
    const hit = threatMemo.get(sorted);
    if (hit !== undefined) return hit;
    let cost = 0;
    opponents.forEach((o, i) => (cost += weight[i] * chanceOf(piles, o)));
    threatMemo.set(sorted, cost);
    return cost;
  };

  /** Where the turn leaves the table, before the discard. */
  const position = () => {
    let e = -threat();
    if (mateInfo) {
      // Our partner plays from both stocks and both sets of discard piles on its turn.
      const stocks = [];
      for (let i = 0; i < owners.length; i++) if (stockVal[i] >= 0) stocks.push(stockVal[i]);
      const mateStacks = vals.map((s, k) => s.slice(0, ptr[k]));
      e += MATE * later(mateInfo.k) * chanceOf(piles, { seat: mateInfo.seat, stocks, stacks: mateStacks });
    }
    if (stockVal[0] > 0) {
      let best = 0;
      for (let i = 0; i < PILES; i++) best = Math.max(best, bridge(gapFor(piles[i], stockVal[0], own, ptr, hand)));
      e += OWN * best;
    } else if (stockVal[0] === 0) e += OWN;
    let jokers = hand[0];
    for (let k = 0; k < PILES; k++) for (let j = 0; j < ptr[k]; j++) if (own[k][j] === 0) jokers += 1;
    e += JOKER * jokers + HAND_CARD * (hand0 - handN);
    let thrown = 0;
    for (let k = 0; k < ptr.length; k++) thrown += ptr0[k] - ptr[k];
    return e + THROWN * thrown;
  };

  /** The best discard now: its score and what it is (hand number, slot). */
  const bestDiscard = () => {
    let empty = 0;
    for (let k = 0; k < PILES; k++) if (!ptr[k]) empty += 1;
    const sv = stockVal[0] >= 0 ? stockVal[0] : null;
    let best = { s: -Infinity, c: -1, slot: 0 };
    for (let c = 0; c <= TOP; c++) {
      if (!hand[c]) continue;
      for (let slot = 0; slot < PILES; slot++) {
        const s = discardScore(c, own[slot], ptr[slot], piles, sv, empty, hand[c] > 1);
        if (s > best.s + 1e-9) best = { s, c, slot };
      }
    }
    return best;
  };

  const stop = () => position() + (handN ? bestDiscard().s : 0);

  /** The chance a stock card not yet seen fits a pile now: a Joker, or one of the piles' next numbers. */
  const fitsUnseen = () => {
    let distinct = 0;
    for (let i = 0; i < PILES; i++) if (piles.indexOf(piles[i]) === i) distinct += 1;
    return 18 / 162 + (144 / 162) * (distinct / TOP);
  };

  const keyOf = () => {
    const p = [...piles].sort((a, b) => a - b).join('');
    return `${p}|${hand.join(',')}|${ptr.join(',')}|${stockVal.join(',')}|${drawable ? 1 : 0}`;
  };

  /**
   * Every distinct play now, each as apply/undo around a callback: the piles of equal length count
   * once; stock cards first, then the discard piles, the hand's number, a Joker.
   * @param {(kind: 'stock' | 'discard' | 'hand' | 'joker', pile: number, which: number) => void} fn
   */
  const eachPlay = (fn) => {
    for (let pile = 0; pile < PILES; pile++) {
      const L = piles[pile];
      if (piles.indexOf(L) !== pile) continue;
      const w = L + 1;
      for (let i = 0; i < stockVal.length; i++) if (stockVal[i] === 0 || stockVal[i] === w) fn('stock', pile, i);
      for (let k = 0; k < vals.length; k++) {
        if (!ptr[k]) continue;
        const tv = vals[k][ptr[k] - 1];
        if (tv === w || tv === 0) fn('discard', pile, k);
      }
      if (hand[w]) fn('hand', pile, w);
      if (hand[0]) fn('joker', pile, 0);
    }
  };

  let nodes = 0;
  const memo = new Map();

  /**
   * One play's worth: apply it, value what follows, undo it.
   * @param {'stock' | 'discard' | 'hand' | 'joker'} kind  @param {number} pile  @param {number} which
   */
  const tryPlay = (kind, pile, which) => {
    const L = piles[pile];
    const len = L + 1;
    piles[pile] = len === TOP ? 0 : len;
    const wasDrawable = drawable;
    if (len === TOP) drawable = true;
    let gain = -STEP;
    let val;
    if (kind === 'stock') {
      const sv = stockVal[which];
      left[which] -= 1;
      if (left[which] === 0 && left.every((n) => n === 0)) val = WIN;
      else {
        stockVal[which] = left[which] ? -1 : -2;
        gain += STOCK + (left[which] ? STOCK * NEXT * fitsUnseen() : 0);
        val = gain + node();
        stockVal[which] = sv;
      }
      left[which] += 1;
    } else {
      if (kind === 'discard') ptr[which] -= 1;
      else {
        hand[which] -= 1;
        handN -= 1;
      }
      if (!handN && drawable) val = gain + REFILL + position();
      else val = gain + node();
      if (kind === 'discard') ptr[which] += 1;
      else {
        hand[which] += 1;
        handN += 1;
      }
    }
    // A stock card played with an empty hand can't refill it here: covered by the next look.
    drawable = wasDrawable;
    piles[pile] = L;
    return val;
  };

  const node = () => {
    const key = keyOf();
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    nodes += 1;
    if (nodes > MASTER_NODES || ((nodes & 63) === 0 && now() > until)) throw ABORT;
    let best = stop();
    eachPlay((kind, pile, which) => {
      const val = tryPlay(kind, pile, which);
      if (val > best) best = val;
    });
    memo.set(key, best);
    return best;
  };

  // The root: every play as a move, the journeyman's first; and the end of the turn, unless the hand is
  // empty with nothing to draw (then any play beats passing).
  /** @type {{ move: Move, kind: 'stock' | 'discard' | 'hand' | 'joker', pile: number, which: number }[]} */
  const options = [];
  eachPlay((kind, pile, which) => {
    /** @type {Move} */
    let move;
    if (kind === 'stock') {
      move = { type: 'play', card: /** @type {number} */ (stockIds[which]), pile, from: 'stock', owner: owners[which] };
    }
    else if (kind === 'discard') {
      const s = stacks[which];
      move = { type: 'play', card: s.ids[s.ids.length - 1], pile, from: 'discard', slot: s.slot, owner: s.owner };
    } else {
      const card = /** @type {number} */ (v.hand.find((id) => value(id) === (kind === 'joker' ? 0 : which)));
      move = { type: 'play', card, pile, from: 'hand' };
    }
    options.push({ move, kind, pile, which });
  });
  // The journeyman's play may name a twin of the pile listed (the same length): matched by card and length.
  const preferAt = prefer.type !== 'play' ? -1 : options.findIndex(
    (o) => o.move.type === 'play' && o.move.card === prefer.card && piles[o.pile] === piles[prefer.pile],
  );
  if (preferAt > 0) options.unshift(...options.splice(preferAt, 1));

  /** @type {{ move: Move | null, val: number }} */
  let best = { move: null, val: -Infinity };
  let preferDone = prefer.type !== 'play';
  try {
    const stranded = !handN && !drawable && options.length > 0;
    best = { move: null, val: stranded ? -Infinity : stop() };
    for (const o of options) {
      const val = tryPlay(o.kind, o.pile, o.which);
      if (val > best.val + 1e-9) best = { move: o.move, val };
      if (o.move === options[0].move) preferDone = true;
    }
  } catch (e) {
    if (e !== ABORT) throw e;
    if (!preferDone) return null;
  }
  if (best.move) return best.move;
  if (!handN) return { type: 'end' };
  const d = bestDiscard();
  const card = /** @type {number} */ (v.hand.find((id) => value(id) === d.c));
  return { type: 'discard', card, slot: d.slot };
}
