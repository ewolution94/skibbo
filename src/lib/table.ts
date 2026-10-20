// The table's arithmetic, apart from its drawing: what fits where, whose plates you may lift, the
// order the others sit in, and your own moves shown before the server's answer comes back (a control
// answers the tap, never the server's echo: learnings/ui-preferences.md).

import { isJoker, value, type CardId, type GameState } from './api';
import type { Move, Source } from './match';

/** A plate you lifted: where it lies, whose it is, and which card. */
export interface Pick {
  from: Source;
  /** The hand's index, or the discard pile's slot (0–3); -1 for a stock. */
  i: number;
  owner: number;
  card: CardId;
}

/** Can this card go on a pile that holds n cards? */
export const fits = (n: number, card: CardId) => n < 12 && (isJoker(card) || value(card) === n + 1);

/** The number a card shows: its own, or, for a Joker, what it stands for. */
export const shows = (card: CardId, as = 0) => (isJoker(card) ? as : value(card));

/** Your partner's seat with teams, or -1. */
export function partnerOf(state: GameState, me: number) {
  const team = state.teams?.find((t) => t.includes(me));
  return team ? (team.find((s) => s !== me) ?? -1) : -1;
}

/** The others, in the order they play after you (all seats from the first when you're watching). */
export function othersFrom(players: number, me: number) {
  const start = me >= 0 ? me : -1;
  const out: number[] = [];
  for (let k = 1; k <= players; k++) {
    const seat = (start + k + players) % players;
    if (seat !== me) out.push(seat);
  }
  return out;
}

/** The pick, if the card is still where it was picked. */
export function stillThere(state: GameState, pick: Pick | null): Pick | null {
  if (!pick) return null;
  if (pick.from === 'hand') {
    const i = state.hand.indexOf(pick.card);
    return i >= 0 ? { ...pick, i } : null;
  }
  const seat = state.seats[pick.owner];
  if (!seat) return null;
  if (pick.from === 'stock') return seat.stockTop === pick.card ? pick : null;
  return seat.discards[pick.i]?.at(-1) === pick.card ? pick : null;
}

/** The move that plays a pick onto a pile. */
export function playOf(pick: Pick, pile: number, me: number): Move {
  const move: Move = { type: 'play', card: pick.card, pile, from: pick.from };
  if (pick.from === 'discard') move.slot = pick.i;
  if (pick.from !== 'hand' && pick.owner !== me) move.owner = pick.owner;
  return move;
}

/**
 * Your moves still on their way, laid over the server's state so the table shows them at once. A
 * stock played shows the stock face down until the server turns its next card; a pile that reaches
 * 12 is cleared; a discard ends your turn here (turn -1) until the server says whose it is.
 */
export function withMoves(state: GameState, moves: Move[], me: number): GameState {
  if (!moves.length || me < 0) return state;
  const s: GameState = structuredClone(state);
  for (const m of moves) {
    if (m.type === 'play') {
      const owner = m.owner ?? me;
      if (m.from === 'hand') s.hand = s.hand.filter((c) => c !== m.card);
      else if (m.from === 'stock') {
        const seat = s.seats[owner];
        if (seat.stockTop === m.card) {
          seat.stockTop = null;
          seat.stock = Math.max(0, seat.stock - 1);
        }
      } else if (m.slot !== undefined) {
        const pile = s.seats[owner].discards[m.slot];
        if (pile?.at(-1) === m.card) pile.pop();
      }
      const pile = s.build[m.pile];
      pile.n += 1;
      pile.top = m.card;
      if (pile.n >= 12) {
        pile.n = 0;
        pile.top = null;
        s.done += 12;
      }
    } else if (m.type === 'discard') {
      s.hand = s.hand.filter((c) => c !== m.card);
      s.seats[me].discards[m.slot].push(m.card);
      s.turn = -1;
    } else {
      s.turn = -1;
    }
  }
  s.seats[me].hand = s.hand.length;
  return s;
}

/** Does this event from the server answer that move of yours? */
export function answers(event: { type: string; seat?: number; card?: unknown; pile?: unknown }, move: Move, me: number) {
  if (move.type === 'play') return event.seat === me && event.type === 'play' && event.card === move.card && event.pile === move.pile;
  if (move.type === 'discard') return event.seat === me && event.type === 'discard' && event.card === move.card;
  // The end of a turn with an empty hand: the next turn (someone else's) is the answer.
  return event.type === 'turn' || event.type === 'round';
}

/**
 * The hand's five places: a card keeps its place while it's held, new cards fill the gaps from the
 * left, so nothing slides under a finger when a card leaves.
 */
export function placeHand(before: (CardId | null)[], hand: CardId[]): (CardId | null)[] {
  const size = Math.max(5, hand.length);
  const out: (CardId | null)[] = Array.from({ length: size }, (_, i) => (before[i] !== undefined && before[i] !== null && hand.includes(before[i]!) ? before[i]! : null));
  const placed = new Set(out.filter((c) => c !== null));
  for (const card of hand) {
    if (placed.has(card)) continue;
    const gap = out.indexOf(null);
    out[gap] = card;
  }
  return out;
}
