// Whole games of Skibbo, played by the bots at every rank mixed with random players, two to six seats,
// teams on and off, every stock size, many seeds; and games to 500 over many rounds. After every move:
// all 162 cards still there, no building pile at 12 or more, every move the bots pick legal, every
// event public, no view showing a card it shouldn't. Every game ends, and the scores add up.

import { test } from 'node:test';
import * as R from '../server/rules.mjs';
import { botMove, randomMove } from '../server/bots.mjs';
import { assert, seeded } from './helpers.mjs';

const DECK = Array.from({ length: R.DECK_SIZE }, (_, i) => i);
const PLAYERS = ['apprentice', 'journeyman', 'master', 'random'];
/** A game longer than this many moves never ends; a turn longer than this many plays never finishes. */
const CAP = 20000;
const TURN_CAP = 400;

/** The fields each event may have: nothing else, and a card id only where a card is laid face up. */
const EVENT_KEYS = {
  play: ['type', 'seat', 'from', 'owner', 'slot', 'card', 'pile', 'as'],
  cleared: ['type', 'pile'],
  draw: ['type', 'seat', 'n'],
  reshuffle: ['type', 'n'],
  discard: ['type', 'seat', 'card', 'slot'],
  turn: ['type', 'seat', 'turnNo'],
  stuck: ['type', 'seat'],
  end: ['type', 'seat'],
  deal: ['type', 'round', 'first', 'stock'],
  round: ['type', 'winner', 'team', 'points', 'left'],
  over: ['type', 'standings'],
};

/** The same move, whatever order its fields come in. @param {Record<string, unknown>} m */
const keyOf = (m) => JSON.stringify(Object.keys(m).sort().map((k) => [k, m[k]]));

/** @param {R.State} s */
function checkState(s) {
  const cards = [...s.draw, ...s.done, ...s.build.flat(), ...s.seats.flatMap((x) => [...x.stock, ...x.hand, ...x.discards.flat()])];
  assert.deepEqual(cards.sort((a, b) => a - b), DECK, '162 cards, each once');
  for (const p of s.build) assert.ok(p.length < R.TOP, `a building pile of ${p.length}`);
  s.build.forEach((p) => p.forEach((id, i) => assert.ok(R.fits(i, id), `card ${id} at height ${i + 1}`)));
}

/** What `seat` may see: its hand, every stock's top, the discard piles, the building piles' tops. @param {R.State} s @param {number | null} seat */
function checkView(s, seat) {
  const v = R.view(s, seat);
  const allowed = new Set([
    ...(seat === null ? [] : s.seats[seat].hand),
    ...s.seats.flatMap((x) => [...x.discards.flat(), ...x.stock.slice(-1)]),
    ...s.build.flatMap((p) => p.slice(-1)),
  ]);
  const shown = [...v.hand, ...v.build.map((b) => b.top), ...v.seats.flatMap((x) => [x.stockTop, ...x.discards.flat()])];
  for (const id of shown) if (id !== null) assert.ok(allowed.has(id), `seat ${seat} sees card ${id}`);
  assert.deepEqual(Object.keys(v).sort(), ['build', 'done', 'draw', 'first', 'hand', 'phase', 'players', 'result', 'round', 'rules', 'scores', 'seats', 'teams', 'turn', 'turnNo', 'you']);
  for (const x of v.seats) assert.deepEqual(Object.keys(x).sort(), ['discards', 'hand', 'stock', 'stockTop']);
  assert.equal(v.draw, s.draw.length);
  assert.equal(v.done, s.done.length);
}

/** @param {Record<string, unknown>[]} events */
function checkEvents(events) {
  for (const e of events) {
    const keys = EVENT_KEYS[/** @type {keyof typeof EVENT_KEYS} */ (e.type)];
    assert.ok(keys, `an event of type ${e.type}`);
    assert.deepEqual(Object.keys(e).sort(), [...keys].sort(), `the fields of ${e.type}`);
  }
}

/**
 * Plays one round to its end with these players in the seats (a rank or 'random'), checking
 * everything after every move. Returns the events of the round's end.
 * @param {R.State} s  @param {string[]} seats  @param {(n: number) => number} randomInt
 * @param {(n: number) => number} choose  random play's own dice  @param {boolean} views  check every view
 */
function playRound(s, seats, randomInt, choose, views) {
  let turnNo = s.turnNo;
  let plays = 0;
  for (let n = 0; n < CAP; n++) {
    if (s.phase !== 'play') return;
    const seat = s.turn;
    const v = R.view(s, seat);
    const move = seats[seat] === 'random' ? randomMove(v, choose) : botMove(v, { level: seats[seat] });
    assert.ok(move, `seat ${seat} has a move`);
    const legal = new Set(R.moves(s, seat).map(keyOf));
    assert.ok(legal.has(keyOf(/** @type {Record<string, unknown>} */ (move))), `${seats[seat]}'s ${JSON.stringify(move)} is legal`);
    const events = R.act(s, seat, move, { randomInt });
    checkEvents(events);
    plays = s.turn === seat && s.phase === 'play' ? plays + 1 : 0;
    assert.ok(plays < TURN_CAP, `${seats[seat]} finishes its turn`);
    const turns = events.filter((e) => e.type === 'turn');
    turns.forEach((e) => assert.equal(e.turnNo, ++turnNo, 'turnNo goes up one a turn'));
    assert.equal(s.turnNo, turnNo);
    checkState(s);
    if (views) for (const who of [...Array(s.players).keys(), null]) checkView(s, who);
  }
  assert.fail('the round never ended');
}

/** The round's result scores what the rules say: 25 and 5 per card left in the other side's stocks. @param {R.State} s */
function checkResult(s) {
  const result = /** @type {NonNullable<R.State['result']>} */ (s.result);
  assert.ok(result);
  assert.deepEqual(result.left, s.seats.map((x) => x.stock.length));
  if (result.winner === null) {
    assert.equal(result.points, 0);
    return [];
  }
  const winners = result.team === null ? [result.winner] : /** @type {number[][]} */ (s.teams)[result.team];
  assert.ok(winners.includes(result.winner));
  for (const w of winners) assert.equal(result.left[w], 0, 'the winners\' stocks are empty');
  const others = result.left.reduce((sum, n, seat) => sum + (winners.includes(seat) ? 0 : n), 0);
  assert.equal(result.points, 25 + 5 * others);
  return winners;
}

test('whole games: every rank and random play, 2 to 6 players, teams on and off, every stock size', () => {
  let games = 0;
  let won = 0;
  for (let players = 2; players <= 6; players++) {
    for (const stock of R.STOCKS) {
      if (players * (stock + R.HAND) > R.DECK_SIZE) continue;
      for (const teams of R.teamsFor(players) ? [false, true] : [false]) {
        for (let seed = 1; seed <= 6; seed++) {
          const randomInt = seeded(seed * 1000 + players * 10 + stock);
          const seats = Array.from({ length: players }, (_, i) => PLAYERS[(i + seed + players) % PLAYERS.length]);
          const s = R.createGame({ players, rules: { stock, teams }, first: seed % players, randomInt });
          checkState(s);
          // Every view at every step on two seeds; the rest just the state.
          playRound(s, seats, randomInt, seeded(seed + 77), seed <= 2);
          assert.equal(s.phase, 'over');
          const winners = checkResult(s);
          assert.deepEqual(s.scores, s.seats.map((_, seat) => (winners.includes(seat) ? /** @type {R.Result} */ (s.result).points : 0)));
          games += 1;
          if (winners.length) won += 1;
        }
      }
    }
  }
  assert.equal(games, 108);
  assert.ok(won >= games * 0.9, `${won} of ${games} games won (the rest blocked)`);
});

test('the bots alone, at every rank, finish their games, nearly all with a winner', () => {
  let won = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const players = 2 + (seed % 5);
    const randomInt = seeded(seed * 7);
    const seats = Array.from({ length: players }, (_, i) => PLAYERS[(i + seed) % 3]);
    const s = R.createGame({ players, rules: { stock: seed % 2 ? 10 : 20 }, randomInt });
    playRound(s, seats, randomInt, seeded(seed), false);
    if (checkResult(s).length) won += 1;
  }
  assert.ok(won >= 38, `${won} of 40 won`);
});

test('random players alone end their games too (most of them blocked)', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const players = 2 + (seed % 3);
    const randomInt = seeded(seed * 13);
    const s = R.createGame({ players, rules: { stock: 10 }, randomInt });
    playRound(s, Array(players).fill('random'), randomInt, seeded(seed), seed === 1);
    assert.equal(s.phase, 'over');
    checkResult(s);
  }
});

test('games to 500: round after round, the first seat moving on, the scores adding up', () => {
  for (const [players, teams, seed] of /** @type {[number, boolean, number][]} */ ([[2, false, 1], [3, false, 2], [4, true, 3], [6, true, 4]])) {
    const randomInt = seeded(seed * 101);
    const seats = Array.from({ length: players }, (_, i) => PLAYERS[(i + seed) % 3]);
    const s = R.createGame({ players, rules: { stock: 10, teams, target: 500 }, randomInt });
    const total = Array(players).fill(0);
    let rounds = 0;
    for (;;) {
      assert.equal(s.round, rounds + 1);
      assert.equal(s.first, rounds % players);
      playRound(s, seats, randomInt, seeded(seed), false);
      rounds += 1;
      const winners = checkResult(s);
      for (const w of winners) total[w] += /** @type {R.Result} */ (s.result).points;
      assert.deepEqual(s.scores, total);
      if (teams) for (const [a, b] of /** @type {number[][]} */ (s.teams)) assert.equal(s.scores[a], s.scores[b], 'partners carry one score');
      if (s.phase === 'over') break;
      assert.equal(s.phase, 'roundEnd');
      assert.ok(Math.max(...s.scores) < 500);
      checkEvents(R.nextRound(s, { randomInt }));
      checkState(s);
      assert.ok(rounds < 200, 'the game ends');
    }
    assert.ok(Math.max(...s.scores) >= 500);
    assert.ok(rounds >= 2, `${rounds} rounds to 500`);
    const top = R.standings(s)[0];
    assert.equal(top.score, Math.max(...s.scores));
  }
});
