<!--
  Between rounds (a game to 500): who won the round and why the points are what they are, everyone's
  stock left and score, and the seconds until the next deal. It floats over the table, which keeps
  its size underneath.
-->
<script lang="ts">
  import type { GameState } from '../lib/api';
  import { names, t } from '../lib/i18n.svelte';
  import type { MatchView } from '../lib/match';
  import Avatar from './Avatar.svelte';

  let { match, game, left }: { match: MatchView; game: GameState; left: (at: number, now?: number) => number } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });

  const r = $derived(game.result!);
  const me = $derived(match.me);
  const winners = $derived(r.winner === null ? [] : (r.team ?? [r.winner]));
  const title = $derived.by(() => {
    if (r.winner === null) return t('roundBlocked');
    if (winners.includes(me)) return winners.length > 1 ? t('roundWonTeam', { names: names(winners.map((s) => (s === me ? t('you') : match.people[s]?.name ?? '?'))) }) : t('roundWonYou');
    return winners.length > 1 ? t('roundWonTeam', { names: names(winners.map((s) => match.people[s]?.name ?? '?')) }) : t('roundWon', { name: match.people[r.winner]?.name ?? '?' });
  });
  const leftOver = $derived(r.left.reduce((sum, n, seat) => (winners.includes(seat) ? sum : sum + n), 0));
  const secs = $derived(match.nextAt ? Math.max(0, Math.ceil(left(match.nextAt, now) / 1000)) : 0);
  const order = $derived([...game.scores.keys()].sort((a, b) => game.scores[b] - game.scores[a]));
</script>

<div class="veil">
  <div class="sheet card" role="dialog" aria-modal="false" aria-label={title}>
    <h2 class="display">{title}</h2>
    {#if r.winner !== null}<p class="why">{t('roundPoints', { points: r.points, left: leftOver })}</p>{/if}
    <table>
      <thead>
        <tr><th></th><th class="num">{t('stocksLeft')}</th><th class="num">{t('scores')}</th></tr>
      </thead>
      <tbody>
        {#each order as seat (seat)}
          <tr class:won={winners.includes(seat)}>
            <td class="who"><Avatar avatar={match.people[seat]?.avatar} size={24} /><span>{seat === me ? t('you') : match.people[seat]?.name}</span></td>
            <td class="num">{r.left[seat]}</td>
            <td class="num score">{game.scores[seat]}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if match.nextAt}<p class="next">{t('nextRound', { s: secs })}</p>{/if}
  </div>
</div>

<style>
  .veil {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    background: rgb(231 224 211 / 0.55);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
  }
  .card {
    width: min(460px, calc(100% - 32px));
    padding: 26px 26px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 28px;
    line-height: 1.1;
    color: var(--navy);
    text-wrap: balance;
  }
  .why {
    margin: 0;
    color: var(--ink-2);
    font-size: 16px;
    line-height: 1.35;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 17px;
  }
  th {
    font: 700 12px/1.2 var(--face);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--navy);
    padding: 0 0 6px;
  }
  td {
    padding: 7px 0;
    border-top: 1px solid var(--line-2);
  }
  .who {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    width: 30%;
  }
  .score {
    font-weight: 700;
  }
  tr.won td {
    color: var(--fuchsia);
    font-weight: 700;
  }
  .next {
    margin: 4px 0 0;
    text-align: center;
    font-weight: 600;
    color: var(--navy);
    font-variant-numeric: tabular-nums;
  }
</style>
