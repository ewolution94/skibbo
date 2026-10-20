// What the table needs, whoever runs the game: a room on the server (src/lib/room.svelte.ts) or a
// solo game in the page (src/lib/solo.svelte.ts). The table (Table.svelte) shows a MatchView and asks
// a Driver for one thing: a move (a play, a discard, the end of a turn).

import type { Avatar } from './avatar';
import type { CardId, GameState, Level, Standing, TableEvent, View } from './api';

export interface Person {
  name: string;
  avatar: Avatar;
  bot: boolean;
  level?: Level;
  /** Here (a bot always is), or their page is closed. */
  online: boolean;
  /** Left the table: a bot plays for them. */
  gone: boolean;
}

export type Source = 'hand' | 'stock' | 'discard';

export type Move =
  | { type: 'play'; card: CardId; pile: number; from: Source; slot?: number; owner?: number }
  | { type: 'discard'; card: CardId; slot: number }
  | { type: 'end' };

export interface MatchView {
  /** Changes with every new game at the table, so the table starts afresh. */
  id: string;
  /** The game as your seat sees it (only your own hand). */
  state: GameState;
  standings: Standing[];
  /** By seat, in playing order. */
  people: Person[];
  /** Your seat, or -1: watching. */
  me: number;
  /** The table's last events, numbered: what to animate. */
  events: TableEvent[];
  /** A seat whose clock ran out: the bot is finishing its turn. */
  autopilot: number;
  /** When the move's clock runs out (the server's time), or null. */
  endsAt: number | null;
  /** Between rounds: when the next one is dealt (the server's time), or null. */
  nextAt: number | null;
  over: boolean;
}

export interface Driver {
  /** A move of yours; the promise settles when it was taken (or refused: an ApiError). */
  move(move: Move, from?: Element | null): Promise<void>;
  /** Milliseconds until a server timestamp. */
  left(at: number, now?: number): number;
}

/** A room's view as the table sees it. */
export function fromRoom(view: View): MatchView | null {
  const g = view.game;
  if (!g) return null;
  const byId = new Map(view.players.map((p) => [p.id, p]));
  return {
    id: `${view.code}:${g.n}`,
    state: g.state,
    standings: g.standings,
    people: g.seats.map((id, seat) => {
      const p = byId.get(id);
      return {
        name: p?.name ?? '?',
        avatar: p?.avatar ?? (null as unknown as Avatar),
        bot: p?.bot ?? false,
        level: p?.level,
        online: p?.online ?? false,
        gone: g.gone[seat] ?? !p,
      };
    }),
    me: g.seat,
    events: g.events,
    autopilot: g.autopilot,
    endsAt: g.endsAt,
    nextAt: g.nextAt,
    over: view.phase === 'final',
  };
}
