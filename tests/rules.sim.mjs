// The rules over simulated games (`npm run test:sim`, local only): every seat's view, move after move
// in games of random players, never shows what that seat may not see. The rules on fixed deals are in
// rules.test.mjs.

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

const OTHER_PATHS = new Set([
  'you', 'players', 'rules.stock', 'rules.teams', 'rules.target', 'teams', 'teams.*.*', 'round', 'first', 'turn', 'turnNo', 'phase',
  'draw', 'done', 'build.*.n', 'seats.*.stock', 'seats.*.hand', 'scores.*', 'result', 'result.winner', 'result.team',
  'result.points', 'result.left.*',
]);
const CARD_PATHS = new Set(['build.*.top', 'seats.*.stockTop', 'seats.*.discards.*.*', 'hand.*']);

/**
 * Every leaf of a view, with its path (indices as *), so a test can say what each may hold: card ids
 * only where cards may show, everything else a known count or flag.
 * @param {unknown} x  @param {string} [path]  @param {[string, unknown][]} [out]
 */
function leaves(x, path = '', out = []) {
  if (x !== null && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) leaves(v, path ? `${path}.${Array.isArray(x) ? '*' : k}` : k, out);
  } else out.push([path, x]);
  return out;
}

test('no view ever shows another hand, a stock card below the top, the draw pile or the finished piles', () => {
  for (const [players, rules] of /** @type {[number, Record<string, unknown>][]} */ ([[2, {}], [3, { stock: 10 }], [4, { teams: true }], [5, {}], [6, { teams: true, stock: 10 }]])) {
    const randomInt = seeded(players * 31);
    const s = R.createGame({ players, rules, randomInt });
    for (let n = 0; n < 600 && s.phase === 'play'; n++) {
      for (const seat of [...Array(players).keys(), null]) {
        const v = R.view(s, seat);
        const allowed = new Set([
          ...(seat === null ? [] : s.seats[seat].hand),
          ...s.seats.flatMap((x) => [...x.discards.flat(), ...x.stock.slice(-1)]),
          ...s.build.flatMap((p) => p.slice(-1)),
        ]);
        for (const [path, val] of leaves(v)) {
          if (CARD_PATHS.has(path)) {
            if (val !== null) assert.ok(allowed.has(/** @type {number} */ (val)), `seat ${seat} sees card ${val} at ${path}`);
          } else assert.ok(OTHER_PATHS.has(path), `unknown field ${path} in the view`);
        }
      }
      // Random play that keeps the game moving: a play when there is one, two times in three.
      const all = R.moves(s, s.turn);
      const plays = all.filter((m) => m.type === 'play');
      const pool = plays.length && randomInt(3) ? plays : all.filter((m) => m.type !== 'play');
      R.act(s, s.turn, pool[randomInt(pool.length)], { randomInt });
    }
  }
});
