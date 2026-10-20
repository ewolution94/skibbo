// The bots on fixed positions: each rank's habits. The simulations (legal moves over many games,
// honesty, the master's time cap, the ranks heads-up) are in bots.sim.mjs (`npm run test:sim`).

import { test } from 'node:test';
import * as R from '../server/rules.mjs';
import { LEVELS, botMove } from '../server/bots.mjs';
import { assert, seeded } from './helpers.mjs';

/** The k-th card showing number v (0: the k-th Joker). */
const card = (/** @type {number} */ v, k = 0) => (v === 0 ? 144 + k : k * 12 + v - 1);
/** The same move, whatever order its fields come in. @param {Record<string, unknown> | null} m */
const keyOf = (m) => JSON.stringify(m && Object.keys(m).sort().map((k) => [k, m[k]]));

/**
 * A game set up by hand: a fresh state with these seats and piles, `turn` to move; the draw pile is
 * every card not placed elsewhere.
 * @param {{ players?: number, rules?: Record<string, unknown>, turn?: number,
 *   seats?: { stock?: number[], hand?: number[], discards?: number[][] }[], build?: number[][] }} o
 */
function arrange({ players = 2, rules = {}, turn = 0, seats = [], build = [[], [], [], []] }) {
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
  s.done = [];
  s.draw = Array.from({ length: R.DECK_SIZE }, (_, i) => i).filter((id) => !used.has(id));
  return s;
}
const pile = (/** @type {number} */ n, k = 0) => Array.from({ length: n }, (_, i) => card(i + 1, k));

// ---- each rank's habits -----------------------------------------------------------------------------

test('every rank plays its stock card when it fits', () => {
  const s = arrange({ seats: [{ stock: [card(9), card(4)], hand: [card(9, 1), card(10), card(11), card(12), card(12, 1)] }, { stock: [card(6)] }], build: [pile(3), [], [], []] });
  for (const level of LEVELS) assert.deepEqual(botMove(R.view(s, 0), { level }), { type: 'play', card: card(4), pile: 0, from: 'stock', owner: 0 }, level);
});

test('the journeyman takes the cheapest way to its stock card: discard piles first, the hand next, a Joker last', () => {
  // The pile is at 4, the stock card a 7: the 5 from the discard pile, the 6 from the hand.
  let s = arrange({ seats: [{ stock: [card(7)], hand: [card(5), card(6), card(0), card(12)], discards: [[card(5, 1)]] }, { stock: [card(11)] }], build: [pile(4), [], [], []] });
  assert.deepEqual(botMove(R.view(s, 0)), { type: 'play', card: card(5, 1), pile: 0, from: 'discard', slot: 0, owner: 0 });
  // No 5 anywhere: the Joker stands in for it.
  s = arrange({ seats: [{ stock: [card(7)], hand: [card(6), card(0), card(12)] }, { stock: [card(11)] }], build: [pile(4), [], [], []] });
  assert.deepEqual(botMove(R.view(s, 0)), { type: 'play', card: card(0), pile: 0, from: 'hand' });
});

test('the journeyman never brings a pile just below the next player\'s stock card, and keeps its Jokers', () => {
  // Its 3 would bring the pile to 3, just below the next player's 4; its stock card (12) is out of reach.
  const s = arrange({ seats: [{ stock: [card(12)], hand: [card(3), card(8), card(9), card(0), card(11)] }, { stock: [card(4)] }], build: [pile(2), [], [], []] });
  const move = botMove(R.view(s, 0));
  assert.equal(move?.type, 'discard');
  // The beginner plays it, and its Joker after.
  assert.deepEqual(botMove(R.view(s, 0), { level: 'apprentice' }), { type: 'play', card: card(3), pile: 0, from: 'hand' });
});

test('the journeyman discards down a run, keeps an empty pile and its Jokers; the apprentice its highest card', () => {
  const s = arrange({
    seats: [{ stock: [card(11)], hand: [card(8), card(12), card(0), card(2, 4)], discards: [[card(9)], [], [], []] }, { stock: [card(7)] }],
    build: [pile(5), pile(5, 1), pile(5, 2), pile(5, 3)],
  });
  assert.deepEqual(botMove(R.view(s, 0)), { type: 'discard', card: card(8), slot: 0 });
  // The beginner spends its Joker first; without one it lays its highest card on the first empty pile.
  assert.deepEqual(botMove(R.view(s, 0), { level: 'apprentice' }), { type: 'play', card: card(0), pile: 0, from: 'hand' });
  s.seats[0].hand = s.seats[0].hand.filter((id) => !R.isWild(id));
  assert.deepEqual(botMove(R.view(s, 0), { level: 'apprentice' }), { type: 'discard', card: card(12), slot: 1 });
});

test('the master plays on rather than pass when its hand is empty and nothing is left to draw', () => {
  // Every pile at 11, a Joker on its discard pile: the Joker finishes a pile, whose cards refill the hand.
  const s = arrange({ seats: [{ stock: [card(1, 4)], discards: [[card(0)]] }, { stock: [card(1, 5)] }], build: [pile(11), pile(11, 1), pile(11, 2), pile(11, 3)] });
  s.draw = [];
  for (const level of ['journeyman', 'master']) assert.equal(botMove(R.view(s, 0), { level })?.type, 'play', level);
});
