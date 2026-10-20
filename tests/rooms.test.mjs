import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_MS, DEFAULT_SETTINGS, GameError, mergeSettings, MOVE_SECONDS } from '../server/rooms.mjs';
import { RULES } from '../server/rules.mjs';
import { setup, table, watch } from './room-helpers.mjs';

const refused = (fn, code) => assert.throws(fn, (e) => e instanceof GameError && e.code === code, code);

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

test('a room: the host makes it, others join by its code, everyone sees the same lobby', () => {
  const { rooms } = setup();
  const t = table(rooms, 2);
  assert.equal(t.pages[0].view.phase, 'lobby');
  assert.deepEqual(t.pages[0].view.settings, DEFAULT_SETTINGS);
  assert.deepEqual(t.pages[0].view.rules, RULES);
  assert.equal(t.pages[0].view.order.length, 3);
  assert.equal(t.pages[1].view.host, t.host.player);
  assert.deepEqual(rooms.info(t.code), { code: t.code, phase: 'lobby', players: 3, full: false });
  refused(() => rooms.join('ZZZZ', { name: 'X' }), 'no-room');
  refused(() => rooms.create({ name: '' }), 'name');
});

test('settings: the host picks the stock, teams, the length, the clock and the bots; invalid values are ignored', () => {
  const merged = mergeSettings({ ...DEFAULT_SETTINGS }, { ...RULES }, { clock: 'quick', bots: 'master', rules: { stock: 10, teams: true, target: 500 } });
  assert.deepEqual(merged.settings, { clock: 'quick', bots: 'master' });
  assert.deepEqual(merged.rules, { stock: 10, teams: true, target: 500 });
  const bad = mergeSettings({ ...DEFAULT_SETTINGS }, { ...RULES }, { clock: 'slow', bots: 'grandmaster', rules: { stock: 25 } });
  assert.deepEqual(bad.settings, DEFAULT_SETTINGS);
  assert.deepEqual(bad.rules, RULES);

  const { rooms } = setup();
  const t = table(rooms, 1);
  t.act(t.host, 'settings', { rules: { stock: 20, target: 500 } });
  assert.equal(t.pages[1].view.rules.stock, 20);
  assert.equal(t.pages[1].view.rules.target, 500);
  refused(() => t.act(t.seats[1], 'settings', { clock: 'quick' }), 'not-host');
});

test('the order of play: the host moves people with their ids in a new order, or shuffles', () => {
  const { rooms } = setup();
  const t = table(rooms, 2);
  const order = t.pages[0].view.order;
  t.act(t.host, 'order', { order: [order[2], order[0], order[1]] });
  assert.deepEqual(t.pages[1].view.order, [order[2], order[0], order[1]]);
  refused(() => t.act(t.host, 'order', { order: [order[0], order[0], order[1]] }), 'order');
  refused(() => t.act(t.seats[1], 'order', { order }), 'not-host');
  t.act(t.host, 'start');
  assert.deepEqual(t.pages[0].view.game.seats, [order[2], order[0], order[1]], 'the game keeps the lobby order');
});

test('what the rules allow at this table: two to six, teams with four or six, 30 cards up to four', () => {
  const { rooms } = setup();
  const alone = table(rooms, 0);
  refused(() => alone.act(alone.host, 'start'), 'too-few');
  const three = table(rooms, 2);
  three.act(three.host, 'settings', { rules: { teams: true } });
  refused(() => three.act(three.host, 'start'), 'teams');
  const five = table(rooms, 4);
  five.act(five.host, 'settings', { rules: { stock: 30 } });
  refused(() => five.act(five.host, 'start'), 'stock');
});

test('hands are secret: each page sees its own hand, the others’ only as a count', () => {
  const { rooms } = setup(11);
  const t = table(rooms, 3);
  t.act(t.host, 'start');
  const watcher = rooms.join(t.code, { name: 'Zoe' });
  // Joining once the cards are out: a watcher, with no seat.
  const zoe = watch(rooms, t.code, watcher.player);
  const turn = t.pages[0].view.game.state.turn;
  assert.equal(t.pages[turn].view.game.state.hand.length, 5, 'the first player has drawn five');
  for (let i = 0; i < 4; i++) {
    const page = t.pages[i];
    assert.equal(page.view.game.seat, i);
    assert.equal(page.view.game.state.seats[turn].hand, 5);
    const seen = visible(page.view);
    for (let j = 0; j < 4; j++) {
      if (j === i) continue;
      for (const id of t.pages[j].view.game.state.hand) assert.ok(!seen.has(id), `seat ${i} sees a card of seat ${j}'s hand`);
    }
  }
  for (const page of t.pages) for (const id of page.view.game.state.hand) assert.ok(!visible(zoe.view).has(id));
  assert.equal(zoe.view.game.seat, -1);
  assert.deepEqual(zoe.view.game.state.hand, []);
});

test('a move: only the player in turn plays; a discard ends the turn for everyone', () => {
  const { rooms } = setup(3);
  const t = table(rooms, 1);
  t.act(t.host, 'start');
  const g = () => t.pages[0].view.game;
  const turn = g().state.turn;
  const other = 1 - turn;
  const view = t.pages[turn].view.game.state;
  refused(() => t.act(t.seats[other], 'move', { move: { type: 'end' } }), 'turn');
  refused(() => t.act(t.seats[turn], 'move', { move: { type: 'end' } }), 'end');
  const card = view.hand[0];
  t.act(t.seats[turn], 'move', { move: { type: 'discard', card, slot: 2 } });
  assert.equal(g().state.turn, other);
  assert.deepEqual(t.pages[other].view.game.state.seats[turn].discards[2], [card], 'the discard is face up for all');
  assert.equal(t.pages[other].view.game.state.hand.length, 5, 'the next player drew five');
  assert.ok(g().events.some((e) => e.type === 'discard' && e.card === card));
});

test('the clock: when it runs out, a bot finishes the turn; playing yourself is refused meanwhile', () => {
  const { rooms, clock } = setup(2);
  const t = table(rooms, 1);
  t.act(t.host, 'settings', { clock: 'quick' });
  t.act(t.host, 'start');
  const g = () => t.pages[0].view.game;
  const turn = g().state.turn;
  const turnNo = g().state.turnNo;
  assert.ok(g().endsAt);
  clock.advance(MOVE_SECONDS.quick * 1000 + 400);
  assert.equal(g().autopilot === turn || g().state.turnNo > turnNo, true);
  if (g().autopilot === turn) refused(() => t.act(t.seats[turn], 'move', { move: { type: 'end' } }), 'autopilot');
  clock.advance(30_000);
  assert.ok(g().state.turnNo > turnNo, 'the bot ended the turn');
});

test('someone gone on their turn: after a while the bot plays it for them', () => {
  const { rooms, clock } = setup(4);
  const t = table(rooms, 1);
  t.act(t.host, 'start');
  const turn = t.pages[0].view.game.state.turn;
  const turnNo = t.pages[0].view.game.state.turnNo;
  const other = 1 - turn;
  t.pages[turn].close();
  clock.advance(AWAY_MS + 30_000);
  assert.ok(t.pages[other].view.game.state.turnNo > turnNo);
});

test('stop and rematch: the host ends the game for everyone, then deals again or goes back to the lobby', () => {
  const { rooms } = setup();
  const t = table(rooms, 1);
  t.act(t.host, 'start');
  refused(() => t.act(t.seats[1], 'stop'), 'not-host');
  t.act(t.host, 'stop');
  assert.equal(t.pages[1].view.phase, 'final');
  assert.equal(t.pages[1].view.game.ended, 'stopped');
  t.act(t.host, 'rematch');
  assert.equal(t.pages[1].view.phase, 'play');
  assert.equal(t.pages[1].view.game.n, 2);
  t.act(t.host, 'stop');
  t.act(t.host, 'rematch', { lobby: true });
  assert.equal(t.pages[0].view.phase, 'lobby');
});
