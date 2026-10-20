// The server's shapes (server/rooms.mjs → view, server/rules.mjs → view) and the calls that change
// them. Adapted from Würfle's.

import type { Avatar } from './avatar';

export type Phase = 'lobby' | 'play' | 'final' | 'gone';
export type ClockChoice = 'off' | 'relaxed' | 'quick';
/** A bot's rank, as in a guild, weakest first (server/bots.mjs, the family's three). */
export type Level = 'apprentice' | 'journeyman' | 'master';
export const LEVELS: Level[] = ['apprentice', 'journeyman', 'master'];

/** A card: its id, 0 to 161 (server/rules.mjs). Ids 0–143 are the numbers 1–12, 144–161 the Jokers. */
export type CardId = number;
export const DECK_SIZE = 162;
/** The number a card shows, or 0 for a Joker. */
export const value = (id: CardId) => (id < 144 ? (id % 12) + 1 : 0);
export const isJoker = (id: CardId) => id >= 144;

export type Stock = 'auto' | 10 | 20 | 30;
export const STOCKS: Stock[] = ['auto', 10, 20, 30];
/** 0: one round decides; 500: rounds until someone (or a team) has 500 points. */
export type Target = 0 | 500;

export interface Settings {
  clock: ClockChoice;
  /** The bots' rank: every bot's (until the host gives one its own) and the stand-ins'. */
  bots: Level;
}

export interface Rules {
  stock: Stock;
  /** Partners sitting opposite (four or six players). */
  teams: boolean;
  target: Target;
}

export interface Player {
  id: string;
  name: string;
  avatar: Avatar;
  online: boolean;
  bot: boolean;
  level?: Level;
}

export interface BuildPile {
  /** How many cards: also the number it has reached. */
  n: number;
  top: CardId | null;
}

export interface SeatState {
  stockTop: CardId | null;
  /** Cards left in the stock, the top one included. */
  stock: number;
  /** Cards in hand (only your own are shown). */
  hand: number;
  /** The four discard piles, face up, bottom first. */
  discards: CardId[][];
}

export interface RoundResult {
  /** The seat that played its last stock card (with teams, the one that finished the team's), or null: blocked. */
  winner: number | null;
  team: number[] | null;
  points: number;
  /** Cards left in each stock. */
  left: number[];
}

/** The game as your seat may see it (server/rules.mjs → view). */
export interface GameState {
  you: number | null;
  players: number;
  rules: Omit<Rules, 'stock'> & { stock: number };
  teams: number[][] | null;
  round: number;
  first: number;
  turn: number;
  turnNo: number;
  phase: 'play' | 'roundEnd' | 'over';
  draw: number;
  done: number;
  build: BuildPile[];
  seats: SeatState[];
  /** Your own hand (empty when watching). */
  hand: CardId[];
  scores: number[];
  result: RoundResult | null;
}

export interface Standing {
  seat: number;
  score: number;
  place: number;
  [k: string]: unknown;
}

export interface TableEvent {
  n: number;
  type: string;
  seat?: number;
  [k: string]: unknown;
}

export type Ended = 'done' | 'stopped' | 'left';

export interface Game {
  n: number;
  /** Player ids round the table, in playing order. */
  seats: string[];
  gone: boolean[];
  /** Your seat, or -1: watching. */
  seat: number;
  state: GameState;
  standings: Standing[];
  /** A seat whose clock ran out: the bot is finishing its turn. */
  autopilot: number;
  events: TableEvent[];
  endsAt: number | null;
  /** Between rounds: when the next one is dealt. */
  nextAt: number | null;
  startedAt: number;
  endedAt: number | null;
  ended: Ended | null;
  stoppedBy: string | null;
}

export interface View {
  code: string;
  phase: Phase;
  version: number;
  host: string;
  me: string | null;
  settings: Settings;
  rules: Rules;
  notice: string | null;
  /** The players at the table, in playing order. */
  order: string[];
  players: Player[];
  game: Game | null;
  now: number;
}

export interface Seat {
  code: string;
  player: string;
  token: string;
}

export interface Config {
  clocks: ClockChoice[];
  moveSeconds: Record<string, number>;
  players: { min: number; max: number };
  seats: number;
  stocks: number[];
  levels: Level[];
  defaults: Settings & { rules: Rules };
}

/**
 * A refusal from the server ("no-room", "turn" …), a network failure ("offline"), the server or
 * Cloudflare in trouble ("busy": a 5xx without the game's own answer) or no answer in time
 * ("timeout": Folio's track() gave up). The last three are worth "Try again" (waits.ts).
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: 'no-store' });
  } catch {
    // Given up on (the signal from track()), or the network: Safari says "Load failed", Chrome
    // "Failed to fetch", so classify by type (learnings/ios-and-webkit.md).
    throw new ApiError(init.signal?.aborted ? 'timeout' : 'offline');
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const { error, ...detail } = body ?? {};
    throw new ApiError(error ?? (response.status >= 500 ? 'busy' : `http-${response.status}`), response.status, detail);
  }
  return body as T;
}

const post = (body: unknown, token?: string, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { 'x-skibbo-token': token } : {}) },
  body: JSON.stringify(body ?? {}),
  signal,
});

/**
 * A deploy restarts the server and ends every room; for a few seconds a create or join can fail.
 * One quiet retry, then the error (learnings/projects/vollmond.md). Safe for create and join: they
 * carry a key, so a retry gets the seat a first try may have made. Not once the page gave up.
 */
async function again<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (signal?.aborted || !(error instanceof ApiError) || (error.code !== 'offline' && error.status < 500)) throw error;
    await new Promise((r) => setTimeout(r, 1500));
    if (signal?.aborted) throw error;
    return fn();
  }
}

export const api = {
  config: () => again(() => request<Config>('/api/config')),
  create: (name: string, avatar: Avatar, key?: string, signal?: AbortSignal) =>
    again(() => request<Seat>('/api/rooms', post({ name, avatar, key }, undefined, signal)), signal),
  info: (code: string) => request<{ code: string; phase: Phase; players: number; full: boolean }>(`/api/rooms/${code}`),
  join: (code: string, name: string, avatar: Avatar | null, token?: string, key?: string, signal?: AbortSignal) =>
    again(() => request<Seat>(`/api/rooms/${code}/join`, post({ name, avatar, token, key }, undefined, signal)), signal),
  act: (seat: Seat, action: string, body?: unknown, signal?: AbortSignal) => request<void>(`/api/rooms/${seat.code}/${action}`, post(body, seat.token, signal)),
};

/** Room codes: four consonants (server/rooms.mjs → CODE). */
export const CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;
