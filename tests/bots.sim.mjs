// The bots over simulated games (`npm run test:sim`, local only): only legal moves, the same move for
// the same view, honest (what the seat can't see changes nothing), the master's time cap, and the
// ranks in order heads-up. The habits on fixed positions are in bots.test.mjs.

import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as R from '../server/rules.mjs';
import { LEVELS, MASTER_MS, botMove, movesFromView, randomMove } from '../server/bots.mjs';
import { assert, seeded } from './helpers.mjs';

/** The k-th card showing number v (0: the k-th Joker). */
const card = (/** @type {number} */ v, k = 0) => (v === 0 ? 144 + k : k * 12 + v - 1);
/** The same move, whatever order its fields come in. @param {Record<string, unknown> | null} m */
const keyOf = (m) => JSON.stringify(m && Object.keys(m).sort().map((k) => [k, m[k]]));

/**
 * Positions from games of bots at every rank, two to six players, teams on and off: a copy of the
 * state every few moves.
 * @param {number} count
 */
function positions(count) {
  /** @type {R.State[]} */
  const out = [];
  for (let seed = 1; out.length < count; seed++) {
    const players = 2 + (seed % 5);
    const teams = Boolean(R.teamsFor(players)) && seed % 2 === 0;
    const randomInt = seeded(seed * 17);
    const s = R.createGame({ players, rules: { teams, stock: seed % 2 ? 10 : 20 }, randomInt });
    for (let n = 0; s.phase === 'play' && n < 3000; n++) {
      if (n % 5 === 0) out.push(structuredClone(s));
      const level = LEVELS[(s.turn + seed) % LEVELS.length];
      R.act(s, s.turn, /** @type {R.Move} */ (botMove(R.view(s, s.turn), { level })), { randomInt });
    }
  }
  return out.slice(0, count);
}
const POSITIONS = positions(400);

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

test('movesFromView lists exactly what moves() does, for every seat at every point', () => {
  for (const s of POSITIONS) {
    for (let seat = 0; seat < s.players; seat++) assert.deepEqual(movesFromView(R.view(s, seat)), R.moves(s, seat));
    assert.deepEqual(movesFromView(R.view(s, null)), []);
  }
});

test('every rank and random play pick a legal move; no move when it is not the seat\'s turn', () => {
  for (const [i, s] of POSITIONS.entries()) {
    const legal = new Set(R.moves(s, s.turn).map(keyOf));
    const v = R.view(s, s.turn);
    for (const level of [...LEVELS, 'grandmaster']) {
      const move = botMove(v, { level });
      assert.ok(legal.has(keyOf(move)), `${level}: ${JSON.stringify(move)}`);
    }
    assert.ok(legal.has(keyOf(randomMove(v, seeded(i)))));
    assert.equal(botMove(R.view(s, (s.turn + 1) % s.players)), null);
    assert.equal(botMove(R.view(s, null)), null);
  }
  const over = arrange({ seats: [{ stock: [card(1)] }, { stock: [card(9)] }] });
  R.act(over, 0, { type: 'play', card: card(1), pile: 0, from: 'stock' });
  assert.equal(botMove(R.view(over, 0)), null);
});

test('the same view always gives the same move', () => {
  for (const s of POSITIONS.filter((_, i) => i % 2 === 0)) {
    const v = R.view(s, s.turn);
    for (const level of LEVELS) {
      const a = botMove(v, { level });
      assert.deepEqual(botMove(JSON.parse(JSON.stringify(v)), { level }), a);
      assert.deepEqual(botMove(v, { level }), a);
    }
  }
});

/**
 * The state with everything `seat` can't see shuffled: the others' hands, every stock below its top,
 * the draw pile and the finished heap trade their cards around.
 * @param {R.State} s  @param {number} seat  @param {(n: number) => number} randomInt
 */
function shuffleHidden(s, seat, randomInt) {
  const t = structuredClone(s);
  /** @type {[number[], number][]} */
  const slots = [];
  t.seats.forEach((x, i) => {
    if (i !== seat) x.hand.forEach((_, k) => slots.push([x.hand, k]));
    for (let k = 0; k < x.stock.length - 1; k++) slots.push([x.stock, k]);
  });
  t.draw.forEach((_, k) => slots.push([t.draw, k]));
  t.done.forEach((_, k) => slots.push([t.done, k]));
  const ids = slots.map(([a, k]) => a[k]);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  slots.forEach(([a, k], i) => (a[k] = ids[i]));
  return t;
}

test('honest: shuffling everything the seat can\'t see changes neither its view nor any rank\'s move', () => {
  let changed = 0;
  for (const [i, s] of POSITIONS.entries()) {
    const seat = s.turn;
    const t = shuffleHidden(s, seat, seeded(i + 1));
    if (JSON.stringify(t) !== JSON.stringify(s)) changed += 1;
    const v = R.view(s, seat);
    assert.deepEqual(R.view(t, seat), v);
    for (const level of LEVELS) assert.deepEqual(botMove(R.view(t, seat), { level }), botMove(v, { level }), level);
  }
  assert.ok(changed > POSITIONS.length * 0.9, 'the shuffles did move hidden cards');
});

// ---- the master's time ------------------------------------------------------------------------------

/** A position with far more ways to play than any game gives: five Jokers, long runs on four discard piles each side of a team. */
function feast() {
  const s = arrange({ players: 4, rules: { teams: true, stock: 20 } });
  const pool = new Set(Array.from({ length: R.DECK_SIZE }, (_, i) => i));
  const take = (/** @type {(id: number) => boolean} */ ok) => {
    for (const id of pool) {
      if (ok(id)) {
        pool.delete(id);
        return id;
      }
    }
    throw new Error('no such card');
  };
  const num = (/** @type {number} */ v) => (/** @type {number} */ id) => !R.isWild(id) && R.value(id) === v;
  for (const x of s.seats) {
    x.hand = [];
    x.stock = Array.from({ length: 5 }, () => take((id) => !R.isWild(id) && R.value(id) >= 9));
  }
  s.seats[0].hand = Array.from({ length: 5 }, () => take(R.isWild));
  for (const seat of [0, 2]) {
    s.seats[seat].discards = [[12, 11, 10, 9], [8, 7, 6, 5], [4, 3, 2, 1], [12, 6]].map((vals) => vals.map((v) => take(num(v))));
    s.seats[seat].discards[3].push(take(R.isWild));
  }
  s.build = [[], [take(num(1))], [1, 2, 3].map((v) => take(num(v))), [1, 2, 3, 4, 5, 6].map((v) => take(num(v)))];
  s.done = [];
  s.draw = [...pool];
  return s;
}

test('a master\'s decision stays within its time cap, even on a position with millions of ways to play', () => {
  const s = feast();
  const v = R.view(s, 0);
  const legal = new Set(R.moves(s, 0).map(keyOf));
  let slowest = 0;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const move = botMove(v, { level: 'master' });
    slowest = Math.max(slowest, performance.now() - t0);
    assert.ok(legal.has(keyOf(move)));
  }
  assert.ok(slowest < MASTER_MS + 75, `${slowest.toFixed(1)} ms against a cap of ${MASTER_MS}`);
  // With the positions unbounded and a cap of 30 ms, the clock stops it (in a process of its own).
  const url = new URL('../server/bots.mjs', import.meta.url).href;
  const code = `import { botMove } from ${JSON.stringify(url)};
    const v = JSON.parse(process.argv[1]);
    const t0 = performance.now();
    const move = botMove(v, { level: 'master' });
    console.log(JSON.stringify({ ms: performance.now() - t0, move }));`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code, JSON.stringify(v)], {
    env: { ...process.env, SKIBBO_MASTER_MS: '30', SKIBBO_MASTER_NODES: '100000000' },
    encoding: 'utf8',
  });
  const { ms, move } = JSON.parse(out);
  assert.ok(ms < 30 + 75, `${ms.toFixed(1)} ms against a cap of 30`);
  assert.ok(legal.has(keyOf(move)));
});

// ---- the ranks in order -----------------------------------------------------------------------------

/**
 * Heads-up games of `a` against `b` with 10 stock cards, each deal twice with the seats swapped: the
 * share `b` wins.
 * @param {string} a  @param {string} b  @param {number} games
 */
function duel(a, b, games) {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const seats = g % 2 ? [b, a] : [a, b];
    const randomInt = seeded(5000 + Math.floor(g / 2));
    const s = R.createGame({ players: 2, rules: { stock: 10 }, randomInt });
    for (let n = 0; s.phase === 'play'; n++) {
      assert.ok(n < 20000);
      R.act(s, s.turn, /** @type {R.Move} */ (botMove(R.view(s, s.turn), { level: seats[s.turn] })), { randomInt });
    }
    const winner = s.result?.winner;
    if (winner !== null && winner !== undefined && seats[winner] === b) wins += 1;
  }
  return wins / games;
}

test('heads-up the journeyman beats the apprentice, and the master the journeyman', () => {
  const journeyman = duel('apprentice', 'journeyman', 300);
  const master = duel('journeyman', 'master', 300);
  assert.ok(journeyman > 0.55, `the journeyman won ${(journeyman * 100).toFixed(1)} %`);
  assert.ok(master > 0.55, `the master won ${(master * 100).toFixed(1)} %`);
});
