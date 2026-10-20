// Whole games through the rooms (`npm run test:sim`, local only): a game of bots and people to its
// end, and a game to 500 from round to round. The rooms on single moves are in rooms.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_MS, DEFAULT_SETTINGS, GameError, mergeSettings, MOVE_SECONDS, ROUND_PAUSE } from '../server/rooms.mjs';
import { botMove } from '../server/bots.mjs';
import { DECK_SIZE, RULES } from '../server/rules.mjs';
import { setup, table, watch } from './room-helpers.mjs';

const refused = (fn, code) => assert.throws(fn, (e) => e instanceof GameError && e.code === code, code);

/** Runs the clock until the game is over (or gives up). */
function playOut(clock, page, people = [], maxMs = 6 * 60 * 60_000) {
  for (let t = 0; t < maxMs && page.view.phase === 'play'; t += 500) {
    for (const p of people) p();
    clock.advance(500);
  }
  return page.view;
}

/** A person at seat `i` plays as the journeyman would, from what their own page shows. */
function person(t, i) {
  return () => {
    const g = t.pages[i].view?.game;
    if (!g || t.pages[i].view.phase !== 'play' || g.state.phase !== 'play' || g.state.turn !== g.seat) return;
    const move = botMove(g.state, { level: 'journeyman' });
    if (move) t.act(t.seats[i], 'move', { move });
  };
}

/** Every card id a page's view shows: its hand, the stock tops, the discard piles, the piles' tops, the events. */
function visible(view) {
  const g = view.game;
  const ids = new Set(g.state.hand);
  for (const seat of g.state.seats) {
    if (seat.stockTop !== null) ids.add(seat.stockTop);
    for (const pile of seat.discards) for (const id of pile) ids.add(id);
  }
  for (const pile of g.state.build) if (pile.top !== null) ids.add(pile.top);
  for (const e of g.events) if (typeof e.card === 'number') ids.add(e.card);
  return ids;
}

test('a whole game with bots and people: it ends, someone’s stock is empty, the cards add up', () => {
  const { rooms, clock } = setup(5);
  const t = table(rooms, 1);
  t.act(t.host, 'bot', { add: true });
  t.act(t.host, 'bot', { add: true });
  t.act(t.host, 'settings', { rules: { stock: 10 } });
  t.act(t.host, 'start');
  const view = playOut(clock, t.pages[0], [person(t, 0), person(t, 1)]);
  assert.equal(view.phase, 'final');
  assert.equal(view.game.ended, 'done');
  const s = view.game.state;
  assert.equal(s.phase, 'over');
  assert.ok(s.result && s.result.winner !== null);
  assert.equal(s.seats[s.result.winner].stock, 0);
  assert.equal(view.game.standings[0].seat, s.result.winner);
  const onTable = s.draw + s.done + s.build.reduce((n, p) => n + p.n, 0) + s.seats.reduce((n, x) => n + x.stock + x.hand + x.discards.flat().length, 0);
  assert.equal(onTable, DECK_SIZE);
});

test('to 500: a round ends, the result shows, the next round is dealt after the pause', () => {
  const { rooms, clock } = setup(9);
  const t = table(rooms, 0);
  t.act(t.host, 'bot', { add: true });
  t.act(t.host, 'settings', { rules: { stock: 10, target: 500 } });
  t.act(t.host, 'start');
  const page = t.pages[0];
  for (let i = 0; i < 4000 && page.view.game.state.phase === 'play'; i++) {
    person(t, 0)();
    clock.advance(500);
  }
  const g = page.view.game;
  assert.equal(g.state.phase, 'roundEnd');
  assert.ok(g.nextAt > page.view.now);
  assert.ok(g.state.result);
  const round = g.state.round;
  clock.advance(ROUND_PAUSE + 10);
  assert.equal(page.view.game.state.round, round + 1);
  assert.equal(page.view.game.state.phase, 'play');
  assert.equal(page.view.game.nextAt, null);
});
