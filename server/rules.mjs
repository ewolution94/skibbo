// Skibbo's rules: the stock-pile card game as a pure state machine, checked against the publisher's
// leaflets of 1980 to 2011 (plans/skibbo.md). 2 to 6 players, or teams of two with four or six.
//
// The cards: 162, twelve each of 1 to 12 and 18 Jokers (the wild card, any number). A card is an id
// 0 to 161, so two 7s in one hand stay two cards: value(id) is its number, 0 for a Joker.
//
// A round: everyone gets a stock pile (its top card face up; 30 cards each with two to four players,
// 20 with five or six, or the host's 10, 20 or 30), four discard piles of their own, and no hand: a
// seat draws up to five at the start of its turn. In the middle, four building piles go from 1 to 12
// in order: an empty pile takes a 1, a pile of n cards takes n + 1; a Joker stands for whatever is
// next, so a pile's number is simply its length. At 12 a pile is set aside (the finished heap) and its
// place is empty again; when the draw pile runs out, the finished heap is shuffled into a new one.
//
// A turn: draw up to five, then any number of plays onto the building piles from the hand, the stock's
// top card or the top of any of the seat's four discard piles (with teams also from the partner's
// stock and discard piles, never onto them). An empty hand draws five more at once, as often as it
// happens. The turn ends with one card from the hand onto one of the seat's own discard piles, or,
// with nothing left in hand and nothing to draw, with { type: 'end' }. Playing the stock card is
// never forced. Whoever plays the last card of their stock wins the round; with teams, a team wins
// once both partners' stocks are empty. The winner scores 25, and 5 for every card left in the
// others' stocks. A seat with an empty hand and no play when its turn starts is stuck and passes, and
// one that ends its turn without having played passes too; once every seat in a row has passed, the
// round ends blocked, with no winner.
//
// The house rules (RULES, cleanRules): the stock's size, teams (four or six players, partners
// opposite), and the target: 0, one round decides the game, or 500, rounds until someone gets there.
//
// Moves (plain JSON, from the page or a bot):
//   { type: 'play', card, pile, from: 'hand' | 'stock' | 'discard', slot?, owner? }
//       card: the id, exactly where `from` says (the stock's top, the top of discard pile `slot`);
//       pile: 0 to 3; owner: whose stock or discard pile (the seat itself, or with teams its partner)
//   { type: 'discard', card, slot }   a hand card onto the seat's own discard pile `slot`; ends the turn
//   { type: 'end' }                   ends the turn with an empty hand
// act() returns events, all public: a draw says how many cards, never which.
//
// No randomness of its own (the shuffles come from the caller's randomInt) and no I/O: the page runs
// this unchanged for the solo game, offline.

export class RuleError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'RuleError';
    this.code = code;
  }
}

export const PLAYERS = Object.freeze({ min: 2, max: 6 });
export const DECK_SIZE = 162;
/** The ids below this are the numbered cards; the 18 above are the Jokers. */
const NUMBERED = 144;
/** A building pile is finished at 12. */
export const TOP = 12;
/** A hand holds up to five after drawing. */
export const HAND = 5;
/** Four building piles in the middle, four discard piles per seat. */
export const PILES = 4;
export const STOCKS = Object.freeze([10, 20, 30]);
export const TARGETS = Object.freeze([0, 500]);
export const RULES = Object.freeze({ stock: 'auto', teams: false, target: 0 });
/** Where a played card may come from. */
export const FROM = Object.freeze(['hand', 'stock', 'discard']);

/** A card's number, 1 to 12; 0 for a Joker. @param {number} id */
export const value = (id) => (id < NUMBERED ? (id % 12) + 1 : 0);
/** @param {number} id */
export const isWild = (id) => id >= NUMBERED;
/** @param {unknown} id */
export const isCard = (id) => typeof id === 'number' && Number.isInteger(id) && id >= 0 && id < DECK_SIZE;

/**
 * @typedef {{ stock: 'auto' | 10 | 20 | 30, teams: boolean, target: 0 | 500 }} Rules
 * @typedef {{ stock: number[], hand: number[], discards: number[][] }} Seat  stock's top is its last card
 * @typedef {{ winner: number | null, team: number | null, points: number, left: number[] }} Result
 * @typedef {{
 *   players: number, rules: Rules & { stock: number }, teams: number[][] | null,
 *   round: number, first: number, turn: number, turnNo: number,
 *   phase: 'play' | 'roundEnd' | 'over',
 *   draw: number[], done: number[], build: number[][], seats: Seat[],
 *   scores: number[], result: Result | null, stuck: number, played: number,
 * }} State
 *   stuck: the passes in a row (a stuck turn, or an end without a play); played: plays this turn
 * @typedef {{ type: 'play', card: number, pile: number, from: 'hand' | 'stock' | 'discard', slot?: number, owner?: number }
 *   | { type: 'discard', card: number, slot: number } | { type: 'end' }} Move
 */

/**
 * The rules from a lobby's settings: the defaults, with every known key that's set replacing its
 * default (null: the defaults). Throws 'rules' for a wrong value; unknown keys are dropped.
 * @param {Record<string, unknown> | null} [input]
 * @returns {Readonly<Rules>}
 */
export function cleanRules(input = {}) {
  if (input === null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new RuleError('rules');
  /** @type {Rules} */
  const out = { ...RULES };
  if (input.stock !== undefined) {
    if (input.stock !== 'auto' && !STOCKS.includes(/** @type {number} */ (input.stock))) throw new RuleError('rules');
    out.stock = /** @type {Rules['stock']} */ (input.stock);
  }
  if (input.teams !== undefined) {
    if (typeof input.teams !== 'boolean') throw new RuleError('rules');
    out.teams = input.teams;
  }
  if (input.target !== undefined) {
    if (!TARGETS.includes(/** @type {number} */ (input.target))) throw new RuleError('rules');
    out.target = /** @type {Rules['target']} */ (input.target);
  }
  return Object.freeze(out);
}

/** The stock's size for `players` under the host's choice: 'auto' is 30 up to four players, 20 from five. */
export const stockFor = (/** @type {number} */ players, /** @type {Rules['stock']} */ stock = 'auto') =>
  stock === 'auto' ? (players <= 4 ? 30 : 20) : stock;

/**
 * The teams, partners opposite each other: four players [[0, 2], [1, 3]], six [[0, 3], [1, 4], [2, 5]];
 * null for any other number.
 * @param {number} players
 */
export function teamsFor(players) {
  if (players === 4) return [[0, 2], [1, 3]];
  if (players === 6) return [[0, 3], [1, 4], [2, 5]];
  return null;
}

/** The index of `seat`'s team, null without teams. @param {number[][] | null} teams @param {number} seat */
export const teamOf = (teams, seat) => {
  if (!teams) return null;
  const t = teams.findIndex((team) => team.includes(seat));
  return t < 0 ? null : t;
};

/** `seat`'s partner, null without teams. @param {number[][] | null} teams @param {number} seat */
export const partnerOf = (teams, seat) => {
  const t = teamOf(teams, seat);
  return t === null ? null : /** @type {number[][]} */ (teams)[t].find((s) => s !== seat) ?? null;
};

/**
 * Whether `card` may go on a building pile of `pileLength` cards: the next number, or a Joker. A full
 * pile (12) takes nothing; it's set aside at once anyway.
 * @param {number} pileLength  @param {number} card
 */
export function fits(pileLength, card) {
  if (!Number.isInteger(pileLength) || pileLength < 0 || pileLength >= TOP || !isCard(card)) return false;
  return isWild(card) || value(card) === pileLength + 1;
}

/** A hand as it's held: low to high, the Jokers last, twins by id. @param {number[]} hand */
export const sortHand = (hand) => [...hand].sort((a, b) => (value(a) || 13) - (value(b) || 13) || a - b);

/**
 * Fisher–Yates in place with the caller's randomInt.
 * @param {number[]} cards  @param {(n: number) => number} randomInt
 */
function shuffle(cards, randomInt) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/**
 * A fresh game: deals round 1 and starts `first`'s turn (it draws its five). randomInt(n) returns
 * 0..n-1 and shuffles. The state's rules carry the stock's size as a number ('auto' resolved).
 * @param {{ players: number, rules?: Record<string, unknown> | null, first?: number,
 *   randomInt: (n: number) => number }} o
 * @returns {State}
 */
export function createGame({ players, rules: raw, first = 0, randomInt }) {
  if (!Number.isInteger(players) || players < PLAYERS.min || players > PLAYERS.max) throw new RuleError('players');
  if (!Number.isInteger(first) || first < 0 || first >= players) throw new RuleError('players');
  const clean = cleanRules(raw);
  const stock = stockFor(players, clean.stock);
  // Every seat's stock and a first hand must come out of the one deck: 30 each only up to four.
  if (players * (stock + HAND) > DECK_SIZE) throw new RuleError('stock');
  if (clean.teams && !teamsFor(players)) throw new RuleError('teams');
  if (typeof randomInt !== 'function') throw new TypeError('createGame needs randomInt to shuffle');
  /** @type {State} */
  const state = {
    players,
    rules: Object.freeze({ ...clean, stock }),
    teams: clean.teams ? teamsFor(players) : null,
    round: 1,
    first,
    turn: first,
    turnNo: 0,
    phase: 'play',
    draw: [],
    done: [],
    build: [[], [], [], []],
    seats: [],
    scores: Array(players).fill(0),
    result: null,
    stuck: 0,
    played: 0,
  };
  deal(state, randomInt, []);
  return state;
}

/**
 * Deals a round: all 162 shuffled, the stocks one card at a time from the first player on, the rest
 * the draw pile; then the first player's turn.
 * @param {State} state  @param {(n: number) => number} randomInt  @param {Record<string, unknown>[]} events
 */
function deal(state, randomInt, events) {
  const deck = shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i), randomInt);
  state.seats = Array.from({ length: state.players }, () => ({ stock: [], hand: [], discards: [[], [], [], []] }));
  for (let k = 0; k < state.rules.stock; k++) {
    for (let i = 0; i < state.players; i++) {
      state.seats[(state.first + i) % state.players].stock.push(/** @type {number} */ (deck.pop()));
    }
  }
  state.draw = deck;
  state.done = [];
  state.build = [[], [], [], []];
  state.result = null;
  state.stuck = 0;
  state.played = 0;
  state.phase = 'play';
  events.push({ type: 'deal', round: state.round, first: state.first, stock: state.rules.stock });
  beginTurn(state, state.first, events, randomInt);
}

/**
 * Starts `seat`'s turn: it draws up to five. A seat left with an empty hand and no play is stuck and
 * passes at once; once every seat in a row has passed, the round ends blocked.
 * @param {State} state  @param {number} seat  @param {Record<string, unknown>[]} events
 * @param {((n: number) => number) | undefined} randomInt
 */
function beginTurn(state, seat, events, randomInt) {
  for (;;) {
    state.turn = seat;
    state.turnNo += 1;
    state.played = 0;
    events.push({ type: 'turn', seat, turnNo: state.turnNo });
    const hand = state.seats[seat].hand;
    drawCards(state, seat, HAND - hand.length, events, randomInt);
    if (hand.length || moves(state, seat).some((m) => m.type === 'play')) return;
    events.push({ type: 'stuck', seat });
    if (passed(state, events)) return;
    seat = (seat + 1) % state.players;
  }
}

/**
 * Counts a pass; true when it was the last seat's in a row and the round has ended blocked.
 * @param {State} state  @param {Record<string, unknown>[]} events
 */
function passed(state, events) {
  state.stuck += 1;
  if (state.stuck < state.players) return false;
  endRound(state, null, events);
  return true;
}

/**
 * Draws up to `n` cards into `seat`'s hand. When the draw pile runs out, the finished heap is shuffled
 * into a new one; with both empty, it draws what there is.
 * @param {State} state  @param {number} seat  @param {number} n  @param {Record<string, unknown>[]} events
 * @param {((n: number) => number) | undefined} randomInt
 */
function drawCards(state, seat, n, events, randomInt) {
  const hand = state.seats[seat].hand;
  let got = 0;
  for (let i = 0; i < n; i++) {
    if (!state.draw.length) {
      if (!state.done.length) break;
      if (typeof randomInt !== 'function') throw new TypeError('act needs randomInt to shuffle the finished piles');
      // What was drawn before the shuffle, then the shuffle, then the rest.
      if (got) events.push({ type: 'draw', seat, n: got });
      got = 0;
      state.draw = shuffle(state.done, randomInt);
      state.done = [];
      events.push({ type: 'reshuffle', n: state.draw.length });
    }
    hand.push(/** @type {number} */ (state.draw.pop()));
    got += 1;
  }
  if (got) events.push({ type: 'draw', seat, n: got });
}

/**
 * What a seat may play from, as moves() and the bots' movesFromView() both see it.
 * @typedef {{ owner: number, stockTop: number | null, discardTops: (number | null)[] }} Source
 * @typedef {{ hand: number[], build: number[], sources: Source[] }} Table
 *   hand: the seat's own, in the order to list; build: the piles' lengths; sources: the seat's own
 *   first, then its partner's
 */

/**
 * Every legal move at a table: plays from the stocks, the discard piles' tops and the hand onto every
 * pile they fit, in that order; then a discard of each hand card onto each of the seat's own piles, or
 * the end of the turn when the hand is empty.
 * @param {Table} t
 * @returns {Move[]}
 */
export function listMoves({ hand, build, sources }) {
  /** @type {Move[]} */
  const out = [];
  /** @param {number} card @param {(pile: number) => Move} move */
  const onto = (card, move) => {
    for (let pile = 0; pile < PILES; pile++) if (fits(build[pile], card)) out.push(move(pile));
  };
  for (const { owner, stockTop } of sources) {
    if (stockTop !== null) onto(stockTop, (pile) => ({ type: 'play', card: stockTop, pile, from: 'stock', owner }));
  }
  for (const { owner, discardTops } of sources) {
    discardTops.forEach((card, slot) => {
      if (card !== null) onto(card, (pile) => ({ type: 'play', card, pile, from: 'discard', slot, owner }));
    });
  }
  for (const card of hand) onto(card, (pile) => ({ type: 'play', card, pile, from: 'hand' }));
  if (!hand.length) out.push({ type: 'end' });
  for (const card of hand) for (let slot = 0; slot < PILES; slot++) out.push({ type: 'discard', card, slot });
  return out;
}

/** The top of a pile of cards, null when it's empty. @param {number[]} cards */
const topOf = (cards) => (cards.length ? cards[cards.length - 1] : null);

/**
 * Every legal move for `seat` now (see listMoves); empty when it isn't its turn.
 * @param {State} state  @param {number} seat
 */
export function moves(state, seat) {
  if (state.phase !== 'play' || seat !== state.turn) return [];
  const mate = partnerOf(state.teams, seat);
  const owners = mate === null ? [seat] : [seat, mate];
  return listMoves({
    hand: sortHand(state.seats[seat].hand),
    build: state.build.map((p) => p.length),
    sources: owners.map((owner) => {
      const { stock, discards } = state.seats[owner];
      return { owner, stockTop: topOf(stock), discardTops: discards.map(topOf) };
    }),
  });
}

/**
 * Makes a move. Changes `state` and returns what happened, in order. `randomInt(n)` (0..n-1) shuffles
 * the finished heap when the draw pile runs out. A refused move leaves the state as it was.
 * @param {State} state  @param {number} seat  @param {Record<string, any>} move
 * @param {{ randomInt?: (n: number) => number }} [ctx]
 */
export function act(state, seat, move, { randomInt } = {}) {
  if (state.phase !== 'play') throw new RuleError('phase');
  if (seat !== state.turn) throw new RuleError('turn');
  if (!move || typeof move !== 'object') throw new RuleError('move');
  /** @type {Record<string, unknown>[]} */
  const events = [];
  if (move.type === 'play') play(state, seat, move, events, randomInt);
  else if (move.type === 'discard') discard(state, seat, move, events, randomInt);
  else if (move.type === 'end') {
    if (state.seats[seat].hand.length) throw new RuleError('end');
    events.push({ type: 'end', seat });
    // An end without a play is a pass.
    if (state.played || !passed(state, events)) beginTurn(state, (seat + 1) % state.players, events, randomInt);
  } else throw new RuleError('move');
  return events;
}

/**
 * @param {State} state  @param {number} seat  @param {Record<string, any>} move
 * @param {Record<string, unknown>[]} events  @param {((n: number) => number) | undefined} randomInt
 */
function play(state, seat, move, events, randomInt) {
  const { card, pile, from } = move;
  if (!FROM.includes(from) || !Number.isInteger(card)) throw new RuleError('move');
  if (!Number.isInteger(pile) || pile < 0 || pile >= PILES) throw new RuleError('pile');
  const owner = move.owner ?? seat;
  // The hand is always the seat's own; a stock or discard pile its own or its partner's.
  if (owner !== seat && (from === 'hand' || owner !== partnerOf(state.teams, seat))) throw new RuleError('owner');
  /** @type {number[]} */
  let source;
  /** @type {number | null} */
  let slot = null;
  if (from === 'hand') source = state.seats[seat].hand;
  else if (from === 'stock') source = state.seats[owner].stock;
  else {
    const k = move.slot;
    if (!Number.isInteger(k) || k < 0 || k >= PILES) throw new RuleError('slot');
    slot = /** @type {number} */ (k);
    source = state.seats[owner].discards[slot];
  }
  const at = from === 'hand' ? source.indexOf(card) : source.length - 1;
  if (at < 0 || source[at] !== card) throw new RuleError('card');
  const target = state.build[pile];
  if (!fits(target.length, card)) throw new RuleError('pile');

  source.splice(at, 1);
  target.push(card);
  state.played += 1;
  state.stuck = 0;
  events.push({ type: 'play', seat, from, owner, slot, card, pile, as: target.length });
  if (target.length === TOP) {
    state.done.push(...target);
    state.build[pile] = [];
    events.push({ type: 'cleared', pile });
  }
  if (from === 'stock' && !source.length) {
    const mate = partnerOf(state.teams, owner);
    if (mate === null || !state.seats[mate].stock.length) {
      endRound(state, seat, events);
      return;
    }
  }
  // An empty hand draws five more at once (also after a play from stock or discard pile has just
  // finished a pile, so there's something to draw again).
  if (!state.seats[seat].hand.length) drawCards(state, seat, HAND, events, randomInt);
}

/**
 * @param {State} state  @param {number} seat  @param {Record<string, any>} move
 * @param {Record<string, unknown>[]} events  @param {((n: number) => number) | undefined} randomInt
 */
function discard(state, seat, move, events, randomInt) {
  const { card, slot } = move;
  if (!Number.isInteger(card)) throw new RuleError('move');
  // Only onto the seat's own discard piles, never its partner's.
  if (move.owner != null && move.owner !== seat) throw new RuleError('owner');
  if (!Number.isInteger(slot) || slot < 0 || slot >= PILES) throw new RuleError('slot');
  const hand = state.seats[seat].hand;
  const at = hand.indexOf(card);
  // Only a hand card may be discarded.
  if (at < 0) throw new RuleError('card');
  hand.splice(at, 1);
  state.seats[seat].discards[slot].push(card);
  state.stuck = 0;
  events.push({ type: 'discard', seat, card, slot });
  beginTurn(state, (seat + 1) % state.players, events, randomInt);
}

/**
 * Ends the round, won by `winner` (the seat whose play emptied the last stock; null: blocked). The
 * winner, or each partner of the winning team, scores 25 and 5 for every card left in the others'
 * stocks. The game is over after one round with target 0, else once someone reaches the target.
 * @param {State} state  @param {number | null} winner  @param {Record<string, unknown>[]} events
 */
function endRound(state, winner, events) {
  const left = state.seats.map((s) => s.stock.length);
  const team = winner === null ? null : teamOf(state.teams, winner);
  const mates = winner === null ? [] : team === null ? [winner] : /** @type {number[][]} */ (state.teams)[team];
  const points = winner === null ? 0 : 25 + 5 * left.reduce((sum, n, s) => sum + (mates.includes(s) ? 0 : n), 0);
  for (const s of mates) state.scores[s] += points;
  state.result = { winner, team, points, left };
  events.push({ type: 'round', winner, team, points, left: [...left] });
  const { target } = state.rules;
  if (!target || state.scores.some((n) => n >= target)) {
    state.phase = 'over';
    events.push({ type: 'over', standings: standings(state) });
  } else state.phase = 'roundEnd';
}

/**
 * Deals the next round (from 'roundEnd', the rooms layer calls it after a pause), the first player one
 * seat further on. Returns its events: the deal and the first turn.
 * @param {State} state  @param {{ randomInt?: (n: number) => number }} [ctx]
 */
export function nextRound(state, { randomInt } = {}) {
  if (state.phase !== 'roundEnd') throw new RuleError('phase');
  if (typeof randomInt !== 'function') throw new TypeError('nextRound needs randomInt to shuffle');
  state.round += 1;
  state.first = (state.first + 1) % state.players;
  /** @type {Record<string, unknown>[]} */
  const events = [];
  deal(state, randomInt, events);
  return events;
}

/**
 * The table's order by score, best first; equal scores share a place (1, 1, 3). With teams, partners
 * carry the same score.
 * @param {State} state
 */
export function standings(state) {
  const all = state.scores.map((score, seat) => ({ seat, score, team: teamOf(state.teams, seat) }));
  return all
    .map((s) => ({ ...s, place: 1 + all.filter((o) => o.score > s.score).length }))
    .sort((a, b) => b.score - a.score || a.seat - b.seat);
}

/**
 * What `seat` may see (null: a spectator): its own hand and no one else's (partners' neither), every
 * stock's top card and size, the discard piles (face up, whole), the building piles' size and top,
 * and only the size of the draw pile and the finished heap.
 * @param {State} state  @param {number | null} [seat]
 */
export function view(state, seat = null) {
  const mine = typeof seat === 'number' && Number.isInteger(seat) && seat >= 0 && seat < state.players;
  return {
    you: mine ? /** @type {number} */ (seat) : null,
    players: state.players,
    rules: { ...state.rules },
    teams: state.teams && state.teams.map((t) => [...t]),
    round: state.round,
    first: state.first,
    turn: state.turn,
    turnNo: state.turnNo,
    phase: state.phase,
    draw: state.draw.length,
    done: state.done.length,
    build: state.build.map((p) => ({ n: p.length, top: topOf(p) })),
    seats: state.seats.map((s) => ({
      stockTop: topOf(s.stock),
      stock: s.stock.length,
      hand: s.hand.length,
      discards: s.discards.map((d) => [...d]),
    })),
    hand: mine ? sortHand(state.seats[/** @type {number} */ (seat)].hand) : [],
    scores: [...state.scores],
    result: state.result && { ...state.result, left: [...state.result.left] },
  };
}

/** @typedef {ReturnType<typeof view>} View */
