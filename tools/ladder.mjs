// The ranks against each other: seeded games of Skibbo between a random player (for scale), the
// apprentice, the journeyman and the master. Heads-up, every pairing plays each deal twice with the
// seats swapped, so the cards favour neither; at four, all four ranks sit at one table, each deal
// played four times with the seats turning, and the order round the table changing from deal to deal
// (who plays right after whom matters: a careless player feeds the next one). How often each wins,
// how many stock cards it has left at the end on average, and how long the master thinks.
//
//   node tools/ladder.mjs [games] [stock]            400 games a pairing by default; stock auto | 10 | 20 | 30
//   SKIBBO_MASTER_MS=60 node tools/ladder.mjs 200    a tighter budget for the master
//
// A blocked round (every seat in a row passed: no card to draw and no play made) counts for nobody.
import { act, cleanRules, createGame, view } from '../server/rules.mjs';
import { MASTER_MS, MASTER_NODES, botMove, randomMove } from '../server/bots.mjs';

const GAMES = Number(process.argv[2] ?? 400);
const stockArg = process.argv[3] ?? 'auto';
const rules = cleanRules({ stock: stockArg === 'auto' ? 'auto' : Number(stockArg) });
const RANKS = ['random', 'apprentice', 'journeyman', 'master'];
/** A game that runs past this many moves is a bug. */
const CAP = 50000;

/** mulberry32: a repeatable random integer below n. @param {number} seed */
function seeded(seed) {
  let a = seed >>> 0;
  return (/** @type {number} */ n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

/** The master's decision times, in ms. @type {number[]} */
const times = [];

/**
 * One game with these ranks in seats 0, 1 …; the deal from `seed`. Returns the winner's seat (null:
 * blocked) and every seat's stock cards left.
 * @param {string[]} seats  @param {number} seed
 */
function play(seats, seed) {
  const randomInt = seeded(20261020 + seed * 7919);
  const choose = seeded(seed + 1);
  const state = createGame({ players: seats.length, rules, first: 0, randomInt });
  for (let n = 0; state.phase === 'play'; n++) {
    if (n > CAP) throw new Error(`game ${seed} never ended`);
    const seat = state.turn;
    const v = view(state, seat);
    const rank = seats[seat];
    const t0 = performance.now();
    const move = rank === 'random' ? randomMove(v, choose) : botMove(v, { level: rank });
    if (rank === 'master') times.push(performance.now() - t0);
    if (!move) throw new Error('no move');
    act(state, seat, move, { randomInt });
  }
  const result = /** @type {NonNullable<typeof state.result>} */ (state.result);
  return { winner: result.winner, left: result.left };
}

const started = Date.now();
const pct = (/** @type {number} */ n, /** @type {number} */ of) => `${((100 * n) / of).toFixed(1)} %`.padStart(7);

console.log(`Skibbo, stock ${rules.stock}, ${GAMES} games a pairing (each deal twice, seats swapped):`);
console.log('  pairing                      wins A   wins B  blocked   left A  left B');
for (let a = 0; a < RANKS.length; a++) {
  for (let b = a + 1; b < RANKS.length; b++) {
    let wa = 0;
    let wb = 0;
    let blocked = 0;
    let la = 0;
    let lb = 0;
    for (let g = 0; g < GAMES; g++) {
      const swap = g % 2 === 1;
      const seats = swap ? [RANKS[b], RANKS[a]] : [RANKS[a], RANKS[b]];
      const { winner, left } = play(seats, Math.floor(g / 2));
      const sa = swap ? 1 : 0;
      if (winner === null) blocked += 1;
      else if (winner === sa) wa += 1;
      else wb += 1;
      la += left[sa];
      lb += left[1 - sa];
    }
    const name = `${RANKS[a]} v ${RANKS[b]}`.padEnd(26);
    const mean = (/** @type {number} */ n) => (n / GAMES).toFixed(1).padStart(6);
    console.log(`  ${name} ${pct(wa, GAMES)}  ${pct(wb, GAMES)}  ${pct(blocked, GAMES)}  ${mean(la)}  ${mean(lb)}`);
  }
}

console.log(`\n  four at one table, ${GAMES} games (each deal four times, the seats turning; six orders round the table):`);
const wins = Object.fromEntries(RANKS.map((r) => [r, 0]));
const left = Object.fromEntries(RANKS.map((r) => [r, 0]));
let blocked = 0;
/** The six orders round a table of four, the random player's seat fixed. */
const ORDERS = [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]]
  .map((o) => [RANKS[0], ...o.map((i) => RANKS[i])]);
for (let g = 0; g < GAMES; g++) {
  const deal = Math.floor(g / 4);
  const order = ORDERS[deal % ORDERS.length];
  const seats = order.map((_, i) => order[(i + g) % 4]);
  const res = play(seats, 100000 + deal);
  if (res.winner === null) blocked += 1;
  else wins[seats[res.winner]] += 1;
  seats.forEach((rank, seat) => (left[rank] += res.left[seat]));
}
console.log('  rank          wins   stock left');
for (const rank of RANKS) {
  console.log(`  ${rank.padEnd(12)} ${pct(wins[rank], GAMES)}  ${(left[rank] / GAMES).toFixed(1).padStart(6)}`);
}
console.log(`  blocked      ${pct(blocked, GAMES)}`);

times.sort((x, y) => x - y);
const at = (/** @type {number} */ q) => times[Math.min(times.length - 1, Math.floor(times.length * q))].toFixed(2);
console.log(`\n  master: ${times.length} decisions, median ${at(0.5)} ms, 95 % ${at(0.95)} ms, 99 % ${at(0.99)} ms,`
  + ` slowest ${at(1)} ms`);
const took = ((Date.now() - started) / 1000).toFixed(1);
console.log(`  (its budget: ${MASTER_MS} ms, ${MASTER_NODES} positions; ${took} s in all)`);
