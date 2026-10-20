// The rules, case by case: the house rules, the deal, what fits, every move and every refusal, piles
// set aside, refills, the draw pile running out, stuck and blocked rounds, winning and scoring, teams,
// rounds to 500, and what each seat's view shows.

import { test } from 'node:test';
import * as R from '../server/rules.mjs';
import { assert, seeded, throws } from './helpers.mjs';

/** The k-th card showing number v (0: the k-th Joker). */
const card = (/** @type {number} */ v, k = 0) => (v === 0 ? 144 + k : k * 12 + v - 1);
/** Cards 1 to n of copy k: a building pile n high. */
const run = (/** @type {number} */ n, k = 0) => Array.from({ length: n }, (_, i) => card(i + 1, k));

/**
 * A game set up by hand: a fresh state with these seats, piles and heaps, `turn` to move (its turn
 * already started). The draw pile is every card not placed elsewhere unless given (top: last); cards
 * placed nowhere are simply out of this game.
 * @param {{ players?: number, rules?: Record<string, unknown>, turn?: number,
 *   seats?: { stock?: number[], hand?: number[], discards?: number[][] }[],
 *   build?: number[][], draw?: number[] | null, done?: number[] }} o
 */
function arrange({ players = 2, rules = {}, turn = 0, seats = [], build = [[], [], [], []], draw = null, done = [] }) {
  const s = R.createGame({ players, rules, first: turn, randomInt: seeded(1) });
  const used = new Set();
  const use = (/** @type {number[]} */ ids) => {
    for (const id of ids) {
      assert.ok(!used.has(id), `card ${id} placed twice`);
      used.add(id);
    }
    return [...ids];
  };
  s.seats = Array.from({ length: players }, (_, i) => {
    const x = seats[i] ?? {};
    return { stock: use(x.stock ?? []), hand: use(x.hand ?? []), discards: [0, 1, 2, 3].map((k) => use(x.discards?.[k] ?? [])) };
  });
  s.build = build.map(use);
  s.done = use(done);
  s.draw = draw ? use(draw) : Array.from({ length: R.DECK_SIZE }, (_, i) => i).filter((id) => !used.has(id));
  return s;
}

const all162 = (/** @type {R.State} */ s) =>
  [...s.draw, ...s.done, ...s.build.flat(), ...s.seats.flatMap((x) => [...x.stock, ...x.hand, ...x.discards.flat()])].sort((a, b) => a - b);
const DECK = Array.from({ length: R.DECK_SIZE }, (_, i) => i);

// ---- the cards and the house rules ----------------------------------------------------------------

test('162 cards: twelve of each number 1 to 12 and 18 Jokers', () => {
  assert.equal(R.DECK_SIZE, 162);
  const counts = Array(13).fill(0);
  for (const id of DECK) counts[R.value(id)] += 1;
  assert.deepEqual(counts, [18, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12]);
  assert.equal(R.value(0), 1);
  assert.equal(R.value(11), 12);
  assert.equal(R.value(12), 1);
  assert.equal(R.value(143), 12);
  assert.equal(R.value(144), 0);
  assert.equal(R.isWild(143), false);
  assert.equal(R.isWild(144), true);
  assert.equal(R.isWild(161), true);
  assert.deepEqual(R.STOCKS, [10, 20, 30]);
  assert.deepEqual(R.PLAYERS, { min: 2, max: 6 });
});

test('cleanRules: the defaults, every valid value, unknown keys dropped, wrong values refused', () => {
  assert.deepEqual(R.cleanRules(), { stock: 'auto', teams: false, target: 0 });
  assert.deepEqual(R.cleanRules(null), R.RULES);
  assert.deepEqual(R.cleanRules({ colour: 'red', stock: 10 }), { stock: 10, teams: false, target: 0 });
  for (const stock of ['auto', 10, 20, 30]) assert.equal(R.cleanRules({ stock }).stock, stock);
  assert.equal(R.cleanRules({ teams: true }).teams, true);
  assert.equal(R.cleanRules({ target: 500 }).target, 500);
  for (const bad of [{ stock: 15 }, { stock: '10' }, { stock: null }, { teams: 1 }, { teams: 'yes' }, { target: 100 }, { target: '500' }]) {
    throws(() => R.cleanRules(bad), 'rules');
  }
  throws(() => R.cleanRules(/** @type {any} */ ('auto')), 'rules');
  throws(() => R.cleanRules(/** @type {any} */ ([])), 'rules');
});

test('teamsFor: partners opposite with four or six, none otherwise', () => {
  assert.deepEqual(R.teamsFor(4), [[0, 2], [1, 3]]);
  assert.deepEqual(R.teamsFor(6), [[0, 3], [1, 4], [2, 5]]);
  for (const n of [2, 3, 5]) assert.equal(R.teamsFor(n), null);
  assert.equal(R.partnerOf(R.teamsFor(6), 4), 1);
  assert.equal(R.partnerOf(null, 1), null);
});

// ---- the deal -------------------------------------------------------------------------------------

test('createGame: stock sizes by player count, the first hand, all 162 cards', () => {
  for (let players = 2; players <= 6; players++) {
    const s = R.createGame({ players, first: players - 1, randomInt: seeded(players) });
    const stock = players <= 4 ? 30 : 20;
    assert.equal(s.rules.stock, stock, `${players} players`);
    assert.deepEqual(all162(s), DECK);
    s.seats.forEach((x, seat) => {
      assert.equal(x.stock.length, stock);
      assert.equal(x.hand.length, seat === players - 1 ? 5 : 0, 'only the first player has drawn');
      assert.deepEqual(x.discards, [[], [], [], []]);
    });
    assert.equal(s.draw.length, 162 - players * stock - 5);
    assert.deepEqual(s.build, [[], [], [], []]);
    assert.equal(s.turn, players - 1);
    assert.equal(s.turnNo, 1);
    assert.equal(s.phase, 'play');
    assert.equal(s.round, 1);
    assert.deepEqual(s.scores, Array(players).fill(0));
    assert.equal(s.result, null);
  }
  // The host's sizes, where the deck holds them: 30 only up to four players.
  assert.equal(R.createGame({ players: 6, rules: { stock: 20 }, randomInt: seeded(1) }).rules.stock, 20);
  assert.equal(R.createGame({ players: 6, rules: { stock: 10 }, randomInt: seeded(1) }).rules.stock, 10);
  assert.equal(R.createGame({ players: 4, rules: { stock: 30 }, randomInt: seeded(1) }).rules.stock, 30);
  throws(() => R.createGame({ players: 5, rules: { stock: 30 }, randomInt: seeded(1) }), 'stock');
  throws(() => R.createGame({ players: 6, rules: { stock: 30 }, randomInt: seeded(1) }), 'stock');
});

test('createGame: teams only with four or six; players and the first seat checked; the same seed deals the same', () => {
  assert.deepEqual(R.createGame({ players: 4, rules: { teams: true }, randomInt: seeded(1) }).teams, [[0, 2], [1, 3]]);
  assert.deepEqual(R.createGame({ players: 6, rules: { teams: true }, randomInt: seeded(1) }).teams, [[0, 3], [1, 4], [2, 5]]);
  assert.equal(R.createGame({ players: 4, randomInt: seeded(1) }).teams, null);
  for (const players of [2, 3, 5]) throws(() => R.createGame({ players, rules: { teams: true }, randomInt: seeded(1) }), 'teams');
  for (const players of [1, 7, 2.5]) throws(() => R.createGame({ players, randomInt: seeded(1) }), 'players');
  throws(() => R.createGame({ players: 3, first: 3, randomInt: seeded(1) }), 'players');
  throws(() => R.createGame({ players: 3, rules: { stock: 25 }, randomInt: seeded(1) }), 'rules');
  assert.deepEqual(R.createGame({ players: 3, randomInt: seeded(9) }), R.createGame({ players: 3, randomInt: seeded(9) }));
  assert.notDeepEqual(R.createGame({ players: 3, randomInt: seeded(9) }).draw, R.createGame({ players: 3, randomInt: seeded(10) }).draw);
});

// ---- what fits --------------------------------------------------------------------------------------

test('fits: an empty pile takes a 1 or a Joker, a pile of n takes n + 1 or a Joker, a full pile nothing', () => {
  assert.ok(R.fits(0, card(1)));
  assert.ok(R.fits(0, card(0)));
  assert.ok(!R.fits(0, card(2)));
  for (let n = 1; n < 12; n++) {
    assert.ok(R.fits(n, card(n + 1)), `${n + 1} on ${n}`);
    assert.ok(!R.fits(n, card(n)), `${n} on ${n}`);
    assert.ok(R.fits(n, card(0, 5)), `Joker on ${n}`);
  }
  assert.ok(!R.fits(12, card(0)));
  assert.ok(!R.fits(12, card(1)));
  assert.ok(!R.fits(-1, card(0)));
  assert.ok(!R.fits(3, 162));
  assert.ok(!R.fits(3, -1));
});

test('a Joker counts as the next number: the play says what it stands for', () => {
  const s = arrange({ seats: [{ hand: [card(0), card(9)] }], build: [run(7), [], [], []] });
  const events = R.act(s, 0, { type: 'play', card: card(0), pile: 0, from: 'hand' });
  assert.deepEqual(events, [{ type: 'play', seat: 0, from: 'hand', owner: 0, slot: null, card: card(0), pile: 0, as: 8 }]);
  // The Joker made the pile 8: a 9 follows.
  R.act(s, 0, { type: 'play', card: card(9), pile: 0, from: 'hand' });
  assert.equal(s.build[0].length, 9);
});

// ---- moves ------------------------------------------------------------------------------------------

test('plays from the hand, the stock top and a discard pile top', () => {
  const s = arrange({ seats: [{ hand: [card(1), card(5)], stock: [card(9), card(2)], discards: [[card(7), card(3)]] }, { stock: [card(12)] }] });
  let events = R.act(s, 0, { type: 'play', card: card(1), pile: 2, from: 'hand' });
  assert.deepEqual(events, [{ type: 'play', seat: 0, from: 'hand', owner: 0, slot: null, card: card(1), pile: 2, as: 1 }]);
  events = R.act(s, 0, { type: 'play', card: card(2), pile: 2, from: 'stock' });
  assert.deepEqual(events, [{ type: 'play', seat: 0, from: 'stock', owner: 0, slot: null, card: card(2), pile: 2, as: 2 }]);
  assert.deepEqual(s.seats[0].stock, [card(9)], 'the next stock card shows');
  events = R.act(s, 0, { type: 'play', card: card(3), pile: 2, from: 'discard', slot: 0, owner: 0 });
  assert.deepEqual(events, [{ type: 'play', seat: 0, from: 'discard', owner: 0, slot: 0, card: card(3), pile: 2, as: 3 }]);
  assert.deepEqual(s.build[2], [card(1), card(2), card(3)]);
  assert.deepEqual(s.seats[0].discards[0], [card(7)]);
  assert.deepEqual(s.seats[0].hand, [card(5)]);
  assert.equal(s.turn, 0, 'plays never end the turn');
});

test('every refusal has its code and leaves the state as it was', () => {
  const s = arrange({
    players: 3,
    seats: [
      { hand: [card(1), card(5)], stock: [card(9), card(4)], discards: [[card(7), card(3)]] },
      { hand: [card(1, 1)], stock: [card(1, 2)], discards: [[card(1, 3)]] },
      { stock: [card(12)] },
    ],
  });
  const before = structuredClone(s);
  const play = (/** @type {Record<string, unknown>} */ m) => () => R.act(s, 0, { type: 'play', pile: 0, ...m });
  throws(() => R.act(s, 1, { type: 'play', card: card(1, 1), pile: 0, from: 'hand' }), 'turn');
  throws(() => R.act(s, 0, /** @type {any} */ (null)), 'move');
  throws(() => R.act(s, 0, { type: 'pass' }), 'move');
  throws(play({ card: card(1), from: 'pocket' }), 'move');
  throws(play({ card: String(card(1)), from: 'hand' }), 'move');
  throws(play({ card: card(1), from: 'hand', pile: 4 }), 'pile');
  throws(play({ card: card(1), from: 'hand', pile: -1 }), 'pile');
  throws(play({ card: card(1), from: 'hand', pile: 0.5 }), 'pile');
  throws(play({ card: card(5), from: 'hand' }), 'pile');
  throws(play({ card: card(1, 1), from: 'hand' }), 'card');
  throws(play({ card: card(9), from: 'stock' }), 'card');
  throws(play({ card: card(7), from: 'discard', slot: 0 }), 'card');
  throws(play({ card: card(3), from: 'discard', slot: 1 }), 'card');
  throws(play({ card: card(3), from: 'discard', slot: 4 }), 'slot');
  throws(play({ card: card(3), from: 'discard' }), 'slot');
  throws(play({ card: card(1, 2), from: 'stock', owner: 1 }), 'owner');
  throws(play({ card: card(1, 3), from: 'discard', slot: 0, owner: 1 }), 'owner');
  throws(play({ card: card(1), from: 'hand', owner: 1 }), 'owner');
  throws(() => R.act(s, 0, { type: 'discard', card: card(5), slot: 4 }), 'slot');
  throws(() => R.act(s, 0, { type: 'discard', card: card(5), slot: 0, owner: 1 }), 'owner');
  throws(() => R.act(s, 0, { type: 'discard', card: 'five', slot: 0 }), 'move');
  // Only a hand card may be discarded: not the stock's top, not a discard pile's.
  throws(() => R.act(s, 0, { type: 'discard', card: card(4), slot: 0 }), 'card');
  throws(() => R.act(s, 0, { type: 'discard', card: card(3), slot: 1 }), 'card');
  throws(() => R.act(s, 0, { type: 'end' }), 'end');
  assert.deepEqual(s, before);
});

test('moves lists every play, then the discards; the end only with an empty hand; nothing out of turn', () => {
  const s = arrange({ seats: [{ hand: [card(2), card(1)], stock: [card(1, 1)], discards: [[], [card(0)]] }, { stock: [card(5)] }], build: [run(1, 3), [], [], []] });
  const m = R.moves(s, 0);
  const plays = m.filter((x) => x.type === 'play');
  assert.deepEqual(plays.slice(0, 3), [
    { type: 'play', card: card(1, 1), pile: 1, from: 'stock', owner: 0 },
    { type: 'play', card: card(1, 1), pile: 2, from: 'stock', owner: 0 },
    { type: 'play', card: card(1, 1), pile: 3, from: 'stock', owner: 0 },
  ]);
  // The Joker on discard pile 1 fits all four piles; the hand, low to high: the 1 three ways, the 2 one.
  assert.equal(plays.filter((x) => x.type === 'play' && x.from === 'discard').length, 4);
  assert.deepEqual(plays.filter((x) => x.type === 'play' && x.from === 'hand').map((x) => x.type === 'play' && [x.card, x.pile]), [
    [card(1), 1], [card(1), 2], [card(1), 3], [card(2), 0],
  ]);
  assert.equal(m.filter((x) => x.type === 'discard').length, 8);
  assert.ok(!m.some((x) => x.type === 'end'));
  assert.deepEqual(R.moves(s, 1), []);
  s.seats[0].hand = [];
  s.draw = [];
  assert.ok(R.moves(s, 0).some((x) => x.type === 'end'));
  assert.ok(!R.moves(s, 0).some((x) => x.type === 'discard'));
});

// ---- piles, refills and the draw pile -----------------------------------------------------------------

test('a pile that reaches 12 is set aside, with a 12 or a Joker', () => {
  const s = arrange({ seats: [{ hand: [card(12), card(0), card(4, 2)] }], build: [run(11), run(11, 1), [], []] });
  let events = R.act(s, 0, { type: 'play', card: card(12), pile: 0, from: 'hand' });
  assert.deepEqual(events, [
    { type: 'play', seat: 0, from: 'hand', owner: 0, slot: null, card: card(12), pile: 0, as: 12 },
    { type: 'cleared', pile: 0 },
  ]);
  assert.deepEqual(s.build[0], []);
  assert.deepEqual(s.done, [...run(11), card(12)]);
  events = R.act(s, 0, { type: 'play', card: card(0), pile: 1, from: 'hand' });
  assert.equal(events[0].as, 12);
  assert.deepEqual(events[1], { type: 'cleared', pile: 1 });
  assert.equal(s.done.length, 24);
  assert.deepEqual(s.build, [[], [], [], []]);
});

test('emptying the hand mid-turn draws five more, as often as it happens', () => {
  // The draw pile's top is its last card: 2, 3, 4, 5, 6 come first, then 7 to 11.
  const s = arrange({ seats: [{ hand: [card(1)] }, { stock: [card(12)] }], draw: [card(9, 3), card(11), card(10), card(9), card(8), card(7), card(6), card(5), card(4), card(3), card(2)] });
  let events = R.act(s, 0, { type: 'play', card: card(1), pile: 0, from: 'hand' });
  assert.deepEqual(events.at(-1), { type: 'draw', seat: 0, n: 5 });
  assert.deepEqual(s.seats[0].hand, [card(2), card(3), card(4), card(5), card(6)]);
  for (let v = 2; v <= 6; v++) events = R.act(s, 0, { type: 'play', card: card(v), pile: 0, from: 'hand' });
  assert.deepEqual(events.at(-1), { type: 'draw', seat: 0, n: 5 });
  assert.deepEqual(s.seats[0].hand, [card(7), card(8), card(9), card(10), card(11)]);
  assert.equal(s.turn, 0);
});

test('the discard that ends a turn never refills the hand; the next seat draws up to five', () => {
  const s = arrange({ seats: [{ hand: [card(5)] }, { hand: [card(7), card(8)], stock: [card(12)] }] });
  const events = R.act(s, 0, { type: 'discard', card: card(5), slot: 3 }, { randomInt: seeded(2) });
  assert.deepEqual(events, [
    { type: 'discard', seat: 0, card: card(5), slot: 3 },
    { type: 'turn', seat: 1, turnNo: 2 },
    { type: 'draw', seat: 1, n: 3 },
  ]);
  assert.deepEqual(s.seats[0].hand, []);
  assert.deepEqual(s.seats[0].discards[3], [card(5)]);
  assert.equal(s.seats[1].hand.length, 5);
  assert.equal(s.turn, 1);
});

test('when the draw pile runs out, the piles set aside are shuffled into a new one', () => {
  const s = arrange({ seats: [{ hand: [card(5)] }, { stock: [card(12)] }], draw: [card(2), card(3)], done: run(12, 4) });
  const events = R.act(s, 0, { type: 'discard', card: card(5), slot: 0 }, { randomInt: seeded(3) });
  assert.deepEqual(events.slice(1), [
    { type: 'turn', seat: 1, turnNo: 2 },
    { type: 'draw', seat: 1, n: 2 },
    { type: 'reshuffle', n: 12 },
    { type: 'draw', seat: 1, n: 3 },
  ]);
  assert.equal(s.done.length, 0);
  assert.equal(s.draw.length, 9);
  assert.equal(s.seats[1].hand.length, 5);
});

test('with the draw pile and the finished piles both empty, a seat draws what there is', () => {
  const s = arrange({ seats: [{ hand: [card(5)] }, { stock: [card(12)] }], draw: [card(2)] });
  const events = R.act(s, 0, { type: 'discard', card: card(5), slot: 0 }, { randomInt: seeded(3) });
  assert.deepEqual(events.slice(1), [{ type: 'turn', seat: 1, turnNo: 2 }, { type: 'draw', seat: 1, n: 1 }]);
  assert.deepEqual(s.seats[1].hand, [card(2)]);
});

test('an empty hand with nothing to draw plays on from stock and discard piles, then ends the turn', () => {
  const s = arrange({ seats: [{ stock: [card(9), card(1)], discards: [[card(2)]] }, { stock: [card(12)], hand: [card(4)] }], draw: [] });
  R.act(s, 0, { type: 'play', card: card(1), pile: 0, from: 'stock' });
  R.act(s, 0, { type: 'play', card: card(2), pile: 0, from: 'discard', slot: 0 });
  const events = R.act(s, 0, { type: 'end' });
  assert.deepEqual(events, [{ type: 'end', seat: 0 }, { type: 'turn', seat: 1, turnNo: 2 }]);
  assert.equal(s.stuck, 0, 'an end after a play is no pass');
});

test('a pile finished while the hand is empty refills it from the shuffled piles', () => {
  const s = arrange({ seats: [{ discards: [[card(12)]], stock: [card(5, 3)] }, { stock: [card(9, 3)] }], build: [run(11), [], [], []], draw: [] });
  const events = R.act(s, 0, { type: 'play', card: card(12), pile: 0, from: 'discard', slot: 0 }, { randomInt: seeded(4) });
  assert.deepEqual(events.slice(1), [{ type: 'cleared', pile: 0 }, { type: 'reshuffle', n: 12 }, { type: 'draw', seat: 0, n: 5 }]);
  assert.equal(s.seats[0].hand.length, 5);
});

// ---- stuck and blocked ----------------------------------------------------------------------------------

test('a seat with an empty hand and no play passes at once', () => {
  const s = arrange({
    players: 3,
    seats: [{ hand: [card(5)], stock: [card(10)] }, { stock: [card(9)] }, { stock: [card(1)] }],
    draw: [],
  });
  const events = R.act(s, 0, { type: 'discard', card: card(5), slot: 0 });
  assert.deepEqual(events, [
    { type: 'discard', seat: 0, card: card(5), slot: 0 },
    { type: 'turn', seat: 1, turnNo: 2 },
    { type: 'stuck', seat: 1 },
    { type: 'turn', seat: 2, turnNo: 3 },
  ]);
  assert.equal(s.turn, 2);
  assert.equal(s.stuck, 1);
  // Seat 2 plays: the passes start over.
  R.act(s, 2, { type: 'play', card: card(1), pile: 0, from: 'stock' });
  assert.equal(s.stuck, 0);
});

test('once every seat in a row has passed, the round ends blocked: no winner, no points', () => {
  const s = arrange({ seats: [{ stock: [card(9)] }, { stock: [card(10), card(11)] }], draw: [] });
  const events = R.act(s, 0, { type: 'end' });
  assert.deepEqual(events, [
    { type: 'end', seat: 0 },
    { type: 'turn', seat: 1, turnNo: 2 },
    { type: 'stuck', seat: 1 },
    { type: 'round', winner: null, team: null, points: 0, left: [1, 2] },
    { type: 'over', standings: [{ seat: 0, score: 0, team: null, place: 1 }, { seat: 1, score: 0, team: null, place: 1 }] },
  ]);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result, { winner: null, team: null, points: 0, left: [1, 2] });
  throws(() => R.act(s, 1, { type: 'end' }), 'phase');
});

test('ending turns without a play counts as passing: a whole round of it blocks the round', () => {
  // Both could play their Joker; neither does.
  const s = arrange({ seats: [{ stock: [card(9)], discards: [[card(0)]] }, { stock: [card(10)], discards: [[card(0, 1)]] }], draw: [] });
  R.act(s, 0, { type: 'end' });
  assert.equal(s.phase, 'play');
  const events = R.act(s, 1, { type: 'end' });
  assert.deepEqual(events.slice(1).map((e) => e.type), ['round', 'over']);
  assert.equal(s.result?.winner, null);
});

// ---- winning and scoring ---------------------------------------------------------------------------------

test('the last stock card wins at once: 25 and 5 for every card left in the others\' stocks', () => {
  const s = arrange({
    players: 3,
    seats: [{ stock: [card(1)], hand: [card(5)] }, { stock: [card(2), card(3), card(4), card(5, 1)] }, { stock: [card(6), card(7)] }],
  });
  const events = R.act(s, 0, { type: 'play', card: card(1), pile: 0, from: 'stock' });
  assert.deepEqual(events.slice(1), [
    { type: 'round', winner: 0, team: null, points: 55, left: [0, 4, 2] },
    {
      type: 'over',
      standings: [{ seat: 0, score: 55, team: null, place: 1 }, { seat: 1, score: 0, team: null, place: 2 }, { seat: 2, score: 0, team: null, place: 2 }],
    },
  ]);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.scores, [55, 0, 0]);
  assert.deepEqual(s.result, { winner: 0, team: null, points: 55, left: [0, 4, 2] });
  throws(() => R.act(s, 0, { type: 'discard', card: card(5), slot: 0 }), 'phase');
  throws(() => R.nextRound(s, { randomInt: seeded(1) }), 'phase');
  assert.deepEqual(R.moves(s, 0), []);
});

// ---- teams ----------------------------------------------------------------------------------------------

test('teams: play from the partner\'s stock and discard piles, never an opponent\'s, never discard onto them', () => {
  const s = arrange({
    players: 4,
    rules: { teams: true },
    seats: [
      { hand: [card(9), card(8)], stock: [card(12), card(11)] },
      { stock: [card(1, 1)], discards: [[card(2, 1)]] },
      { stock: [card(10), card(1)], discards: [[], [card(2)]] },
      { stock: [card(12, 1)] },
    ],
  });
  throws(() => R.act(s, 0, { type: 'play', card: card(1, 1), pile: 0, from: 'stock', owner: 1 }), 'owner');
  let events = R.act(s, 0, { type: 'play', card: card(1), pile: 0, from: 'stock', owner: 2 });
  assert.deepEqual(events, [{ type: 'play', seat: 0, from: 'stock', owner: 2, slot: null, card: card(1), pile: 0, as: 1 }]);
  throws(() => R.act(s, 0, { type: 'play', card: card(2, 1), pile: 0, from: 'discard', slot: 0, owner: 1 }), 'owner');
  events = R.act(s, 0, { type: 'play', card: card(2), pile: 0, from: 'discard', slot: 1, owner: 2 });
  assert.equal(events[0].as, 2);
  assert.deepEqual(s.seats[2].discards[1], []);
  throws(() => R.act(s, 0, { type: 'discard', card: card(9), slot: 0, owner: 2 }), 'owner');
  R.act(s, 0, { type: 'discard', card: card(9), slot: 0 }, { randomInt: seeded(1) });
  assert.deepEqual(s.seats[0].discards[0], [card(9)]);
  assert.deepEqual(s.seats[2].discards[0], []);
});

test('teams: a team wins once both stocks are empty, each partner scoring; the one out first plays on', () => {
  const s = arrange({
    players: 4,
    rules: { teams: true },
    seats: [{ stock: [card(1)], hand: [card(7)] }, { stock: [card(9), card(9, 1)] }, { stock: [card(3), card(2)] }, { stock: [card(10)] }],
  });
  let events = R.act(s, 0, { type: 'play', card: card(1), pile: 0, from: 'stock' });
  assert.equal(events.length, 1, 'no win: the partner still has a stock');
  assert.equal(s.phase, 'play');
  assert.deepEqual(s.seats[0].stock, []);
  // With its own stock empty, seat 0 plays on from its partner's.
  R.act(s, 0, { type: 'play', card: card(2), pile: 0, from: 'stock', owner: 2 });
  R.act(s, 0, { type: 'discard', card: card(7), slot: 0 }, { randomInt: seeded(1) });
  // Seat 1 passes its turn on; seat 2 plays its own last card and wins for both.
  R.act(s, 1, { type: 'discard', card: s.seats[1].hand[0], slot: 0 }, { randomInt: seeded(1) });
  assert.equal(s.turn, 2);
  events = R.act(s, 2, { type: 'play', card: card(3), pile: 0, from: 'stock' });
  assert.deepEqual(events.at(-2), { type: 'round', winner: 2, team: 0, points: 25 + 5 * 3, left: [0, 2, 0, 1] });
  assert.deepEqual(s.scores, [40, 0, 40, 0]);
  assert.deepEqual(R.standings(s).map((x) => [x.seat, x.place, x.team]), [[0, 1, 0], [2, 1, 0], [1, 3, 1], [3, 3, 1]]);
});

test('teams: a partner whose stock is empty plays on from the other\'s stock and discard piles', () => {
  const s = arrange({
    players: 6,
    rules: { teams: true },
    turn: 4,
    seats: [{}, { stock: [card(12), card(1)], discards: [[card(2)]] }, { stock: [card(9)] }, { stock: [card(9, 1)] }, { hand: [card(3)], stock: [] }, { stock: [card(9, 2)] }],
  });
  R.act(s, 4, { type: 'play', card: card(1), pile: 0, from: 'stock', owner: 1 });
  R.act(s, 4, { type: 'play', card: card(2), pile: 0, from: 'discard', slot: 0, owner: 1 });
  R.act(s, 4, { type: 'play', card: card(3), pile: 0, from: 'hand' });
  assert.equal(s.build[0].length, 3);
});

// ---- rounds to 500 ------------------------------------------------------------------------------------------

test('target 500: a round won ends in roundEnd, the next round deals afresh one seat on, 500 ends it', () => {
  const s = arrange({ rules: { target: 500, stock: 10 }, seats: [{ stock: [card(1)] }, { stock: [card(5), card(6)] }] });
  throws(() => R.nextRound(s, { randomInt: seeded(1) }), 'phase');
  let events = R.act(s, 0, { type: 'play', card: card(1), pile: 0, from: 'stock' });
  assert.deepEqual(events.at(-1), { type: 'round', winner: 0, team: null, points: 35, left: [0, 2] });
  assert.equal(s.phase, 'roundEnd');
  assert.deepEqual(s.scores, [35, 0]);
  throws(() => R.act(s, 1, { type: 'end' }), 'phase');

  events = R.nextRound(s, { randomInt: seeded(5) });
  assert.deepEqual(events.slice(0, 2), [{ type: 'deal', round: 2, first: 1, stock: 10 }, { type: 'turn', seat: 1, turnNo: 2 }]);
  assert.deepEqual(events[2], { type: 'draw', seat: 1, n: 5 });
  assert.equal(s.round, 2);
  assert.equal(s.first, 1);
  assert.equal(s.turn, 1);
  assert.equal(s.phase, 'play');
  assert.equal(s.result, null);
  assert.deepEqual(s.scores, [35, 0], 'scores carry over');
  assert.deepEqual(all162(s), DECK);
  assert.ok(s.seats.every((x) => x.stock.length === 10));

  // One more win past 500 ends the game.
  const t = arrange({ rules: { target: 500 }, seats: [{ stock: [card(1)] }, { stock: [card(5), card(6)] }] });
  t.scores = [480, 490];
  events = R.act(t, 0, { type: 'play', card: card(1), pile: 0, from: 'stock' });
  assert.equal(t.phase, 'over');
  assert.deepEqual(events.at(-1), { type: 'over', standings: [{ seat: 0, score: 515, team: null, place: 1 }, { seat: 1, score: 490, team: null, place: 2 }] });
});

// ---- views -----------------------------------------------------------------------------------------------

test('a view shows its own hand, every stock top and discard pile, the piles\' tops; a spectator no hand', () => {
  const s = arrange({
    seats: [{ hand: [card(7), card(0), card(2)], stock: [card(9), card(3)], discards: [[card(8), card(6)]] }, { hand: [card(4)], stock: [card(11)] }],
    build: [run(3, 2), [], [], []],
    done: run(12, 5),
  });
  const v = R.view(s, 0);
  assert.equal(v.you, 0);
  assert.deepEqual(v.hand, [card(2), card(7), card(0)], 'low to high, Jokers last');
  assert.deepEqual(v.build, [{ n: 3, top: card(3, 2) }, { n: 0, top: null }, { n: 0, top: null }, { n: 0, top: null }]);
  assert.deepEqual(v.seats[0], { stockTop: card(3), stock: 2, hand: 3, discards: [[card(8), card(6)], [], [], []] });
  assert.deepEqual(v.seats[1], { stockTop: card(11), stock: 1, hand: 1, discards: [[], [], [], []] });
  assert.equal(v.draw, s.draw.length);
  assert.equal(v.done, 12);
  const watcher = R.view(s, null);
  assert.equal(watcher.you, null);
  assert.deepEqual(watcher.hand, []);
  assert.deepEqual(R.view(s, 7).hand, []);
});


test('standings: best first, equal scores share a place', () => {
  const s = arrange({ players: 4 });
  s.scores = [10, 30, 10, 0];
  assert.deepEqual(R.standings(s).map((x) => [x.seat, x.score, x.place]), [[1, 30, 1], [0, 10, 2], [2, 10, 2], [3, 0, 4]]);
});
