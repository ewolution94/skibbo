// A solo game: the rules and the bots (server/rules.mjs, server/bots.mjs) run in the page, so it
// plays with no server and works offline (the service worker keeps the page). You against one to
// five bots, in teams of two when four or six sit down. The game is kept on the device as it goes
// (`skibbo:solo`), so a reload or a locked phone carries on where it was; finished games go into the
// record (`skibbo:record`): games played and won, for the start page.

import { act, createGame, nextRound, RuleError, standings, view as ruleView } from '../../server/rules.mjs';
import { botMove } from '../../server/bots.mjs';
import { ApiError, type GameState, type Level, type Stock, type TableEvent, type Target } from './api';
import { randomAvatar, type Avatar } from './avatar';
import type { Driver, MatchView, Move, Person } from './match';

const GAME = 'skibbo:solo';
const RECORD = 'skibbo:record';
/** As on the server (server/rooms.mjs): a bot thinks before its turn's first move, less after. */
const BOT_THINK = [900, 1500];
const BOT_NEXT = [600, 950];
const ROUND_PAUSE = 9000;
const EVENTS_KEPT = 40;
const BOT_NAMES = ['Robo Rita', 'Bot Bernd', 'Joker Jule', 'Stapel Stefan', 'Nummer Nina'];

export interface SoloSetup {
  /** One to five bots. */
  bots: number;
  level: Level;
  stock: Stock;
  target: Target;
  /** Partners opposite, with four or six at the table. */
  teams: boolean;
}

export interface Record {
  played: number;
  won: number;
}

interface Saved {
  setup: SoloSetup;
  people: Person[];
  state: unknown;
  id: string;
  events: TableEvent[];
  seq: number;
}

/** A fair random integer below n from the browser's crypto, without modulo bias. */
function randomInt(n: number) {
  const a = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do crypto.getRandomValues(a);
  while (a[0] >= limit);
  return a[0] % n;
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not kept
  }
}

export const record = $state<Record>(read<Record>(RECORD) ?? { played: 0, won: 0 });

/** A solo game left unfinished on this device, if any. */
export const savedSolo = () => {
  const s = read<Saved>(GAME);
  const phase = (s?.state as { phase?: string } | undefined)?.phase;
  return s && (phase === 'play' || phase === 'roundEnd') ? s : null;
};

/** Teams need four or six at the table. */
export const teamsFit = (bots: number) => bots === 3 || bots === 5;

export class Solo implements Driver {
  view: MatchView = $state.raw(null as unknown as MatchView);
  /** You (or your team) won this game. */
  won = $state(false);

  #setup: SoloSetup;
  #people: Person[];
  // The full state, hands and all: it never leaves this page.
  #state: any;
  #id: string;
  #events: TableEvent[] = [];
  #seq = 0;
  #timer = 0;
  #nextAt: number | null = null;
  #closed = false;

  constructor(setup: SoloSetup, me: { name: string; avatar: Avatar }, saved: Saved | null = null) {
    if (saved) {
      this.#setup = saved.setup;
      this.#people = saved.people;
      this.#state = saved.state;
      this.#id = saved.id;
      this.#events = saved.events ?? [];
      this.#seq = saved.seq ?? 0;
    } else {
      this.#setup = setup;
      this.#people = [
        { name: me.name, avatar: me.avatar, bot: false, online: true, gone: false },
        ...BOT_NAMES.slice(0, setup.bots).map((name) => ({ name, avatar: randomAvatar(), bot: true, level: setup.level, online: true, gone: false })),
      ];
      const players = this.#people.length;
      const rules = { stock: setup.stock, target: setup.target, teams: setup.teams && teamsFit(setup.bots) };
      this.#state = createGame({ players, rules, first: randomInt(players), randomInt });
      this.#id = `solo:${Date.now().toString(36)}`;
      this.#note([{ type: 'turn', seat: this.#state.turn, turnNo: this.#state.turnNo }]);
    }
    // Back from a reload between rounds: the next one is dealt after the pause.
    if (this.#state.phase === 'roundEnd') this.#nextAt = Date.now() + ROUND_PAUSE;
    this.#publish();
  }

  static resume(me: { name: string; avatar: Avatar }) {
    const saved = savedSolo();
    return saved ? new Solo(saved.setup, me, saved) : null;
  }

  get setup() {
    return this.#setup;
  }

  close() {
    this.#closed = true;
    clearTimeout(this.#timer);
  }

  /** Gives the game up: it's forgotten, and not counted. */
  abandon() {
    this.close();
    write(GAME, null);
  }

  async move(move: Move) {
    this.#move(0, move);
  }

  left(at: number, now = Date.now()) {
    return Math.max(0, at - now);
  }

  #note(events: object[]) {
    for (const e of events) this.#events.push({ ...(e as TableEvent), n: ++this.#seq });
    if (this.#events.length > EVENTS_KEPT) this.#events.splice(0, this.#events.length - EVENTS_KEPT);
  }

  #move(seat: number, move: Move) {
    let events: object[];
    try {
      events = act(this.#state, seat, move, { randomInt }) as object[];
    } catch (error) {
      if (error instanceof RuleError) throw new ApiError((error as RuleError & { code: string }).code, 409);
      throw error;
    }
    this.#note(events);
    const s = this.#state;
    if (s.phase === 'roundEnd') this.#nextAt = Date.now() + ROUND_PAUSE;
    if (s.phase === 'over') this.#finish();
    this.#publish();
  }

  #finish() {
    write(GAME, null);
    const top = (standings(this.#state) as { seat: number; place: number }[]).filter((x) => x.place === 1).map((x) => x.seat);
    const team = (this.#state.teams as number[][] | null)?.find((t) => t.includes(0)) ?? [0];
    this.won = top.some((seat) => team.includes(seat));
    record.played += 1;
    if (this.won) record.won += 1;
    write(RECORD, { ...record });
  }

  #publish() {
    const s = this.#state;
    this.view = {
      id: this.#id,
      state: ruleView(s, 0) as GameState,
      standings: standings(s) as MatchView['standings'],
      people: this.#people,
      me: 0,
      events: [...this.#events],
      autopilot: -1,
      endsAt: null,
      nextAt: s.phase === 'roundEnd' ? this.#nextAt : null,
      over: s.phase === 'over',
    };
    if (s.phase !== 'over') {
      write(GAME, { setup: this.#setup, people: this.#people, state: s, id: this.#id, events: this.#events, seq: this.#seq } satisfies Saved);
      this.#schedule();
    }
  }

  /** The next thing the page does by itself: a bot's move, or the next round's deal. */
  #schedule() {
    clearTimeout(this.#timer);
    const s = this.#state;
    if (this.#closed) return;
    if (s.phase === 'roundEnd') {
      const wait = Math.max(0, (this.#nextAt ?? Date.now()) - Date.now());
      this.#timer = window.setTimeout(() => {
        if (this.#closed || this.#state.phase !== 'roundEnd') return;
        this.#nextAt = null;
        this.#note(nextRound(this.#state, { randomInt }) as object[]);
        this.#publish();
      }, wait);
      return;
    }
    const seat = s.turn;
    if (s.phase !== 'play' || !this.#people[seat]?.bot) return;
    const last = this.#events.at(-1)?.type;
    const [lo, hi] = last === 'turn' || last === 'draw' || last === 'reshuffle' ? BOT_THINK : BOT_NEXT;
    this.#timer = window.setTimeout(() => {
      if (this.#closed || this.#state.turn !== seat || this.#state.phase !== 'play') return;
      const move = botMove(ruleView(this.#state, seat), { level: this.#people[seat].level ?? 'journeyman' }) as Move | null;
      if (move) this.#move(seat, move);
    }, lo + Math.random() * (hi - lo));
  }
}
