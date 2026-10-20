// The table's Driver for a room on the server: every move is one the server checks. The table shows
// a move at once (the plate flies, the hand closes the gap) and keeps it shown while the request is
// out; the wait shows at the control only if the answer is slow (Folio's track(), src/lib/waits.ts).
// Moves go one at a time, in order: the next play may depend on the last.

import type { Driver, Move } from './match';
import type { Room } from './room.svelte';
import { waitAt } from './waits';
import { t } from './i18n.svelte';

export function remote(room: Room): Driver {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    move(move: Move, from?: Element | null) {
      const sent = queue.then(() => waitAt(from, (signal) => room.act('move', { move }, signal), t('wait_move')));
      queue = sent.catch(() => {});
      return sent.then(() => undefined);
    },
    left: (at: number, now?: number) => room.left(at, now),
  };
}
