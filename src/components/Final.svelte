<!--
  The end of a game: who won (a player, or a team of two), and everyone's place with what was left in
  their stock and, playing to 500, their points. Below it, what comes next: at a table the host plays
  again or goes back to the lobby (the actions, from Game.svelte); alone, another game or home
  (SoloGame.svelte). From Würfle's Final.svelte.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { names, t } from '../lib/i18n.svelte';
  import type { MatchView } from '../lib/match';
  import Avatar from './Avatar.svelte';

  let { match, note = '', won = false, actions }: { match: MatchView; note?: string; won?: boolean; actions: Snippet } = $props();

  const s = $derived(match.state);
  const nameAt = (seat: number) => (seat === match.me ? t('you') : (match.people[seat]?.name ?? '?'));
  const toFive = $derived(s.rules.target > 0);
  const result = $derived(s.result);
  // A game stopped early, or ended with nobody left, has no winner.
  const winners = $derived.by(() => {
    if (note || !result || result.winner === null) return toFive && !note ? match.standings.filter((x) => x.place === 1).map((x) => x.seat) : [];
    if (toFive) return match.standings.filter((x) => x.place === 1).map((x) => x.seat);
    return result.team ?? [result.winner];
  });
  const title = $derived.by(() => {
    if (!winners.length) return note ? t('soloDone') : t('noWinner');
    if (winners.includes(match.me)) return winners.length > 1 ? t('winnerTeam', { names: names(winners.map(nameAt)) }) : t('winnerYou');
    return winners.length > 1 ? t('winnerTeam', { names: names(winners.map(nameAt)) }) : t('winner', { name: nameAt(winners[0]) });
  });
  // Places: playing to 500 by points; one round by the cards left in the stock (with teams, the team's).
  const rows = $derived.by(() => {
    const left = result?.left ?? s.seats.map((x) => x.stock);
    const teamOf = (seat: number) => s.teams?.find((tm) => tm.includes(seat)) ?? [seat];
    const key = (seat: number) => (toFive ? -s.scores[seat] : teamOf(seat).reduce((sum, x) => sum + (left[x] ?? 0), 0));
    const seats = [...s.seats.keys()].sort((a, b) => key(a) - key(b) || a - b);
    let place = 0;
    let last = NaN;
    return seats.map((seat, i) => {
      if (key(seat) !== last) {
        place = i + 1;
        last = key(seat);
      }
      return { seat, place, left: left[seat] ?? 0, score: s.scores[seat] ?? 0 };
    });
  });
</script>

<div class="final">
  <section class="sheet head">
    {#if note}<span class="label early">{note}</span>{/if}
    {#if winners.length}
      <div class="crown">
        {#each winners as seat (seat)}
          {@const p = match.people[seat]}
          {#if p?.avatar}<Avatar avatar={p.avatar} size={64} />{/if}
        {/each}
      </div>
    {/if}
    <h1 class="display">{title}</h1>
    {#if won}<p class="best">{t('winnerYou')}</p>{/if}

    <table class="standings">
      <thead>
        <tr>
          <th></th>
          <th></th>
          <th class="num">{t('stocksLeft')}</th>
          {#if toFive}<th class="num">{t('points')}</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.seat)}
          {@const p = match.people[r.seat]}
          <tr class:me={r.seat === match.me} class:won={winners.includes(r.seat)}>
            <td class="place">{r.place}.</td>
            <td class="who">
              <div class="name">
                {#if p?.avatar}<Avatar avatar={p.avatar} size={24} ring={false} />{/if}
                <span>{nameAt(r.seat)}</span>
              </div>
            </td>
            <td class="num">{r.left === 0 ? '–' : r.left}</td>
            {#if toFive}<td class="num sum">{r.score}</td>{/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <div class="actions">
    {@render actions()}
  </div>
</div>

<style>
  .final {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 520px;
    margin: 14px auto 0;
  }
  .head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 26px 22px 20px;
    text-align: center;
  }
  .early {
    color: var(--bad);
  }
  .crown {
    display: flex;
    gap: 6px;
  }
  h1 {
    margin: 0;
    font-size: 32px;
    line-height: 1.1;
    text-wrap: balance;
    color: var(--navy);
  }
  .best {
    margin: 0;
    padding: 5px 12px 4px;
    border-radius: 6px;
    background: var(--fuchsia);
    font: 700 13px/1.2 var(--face);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #ffffff;
    rotate: -3deg;
  }
  .standings {
    width: 100%;
    margin-top: 6px;
    border-collapse: collapse;
    font-size: 17px;
    text-align: left;
  }
  th {
    font: 700 12px/1.2 var(--face);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--navy);
    padding: 0 0 6px;
  }
  td {
    padding: 8px 0;
    border-top: 1px solid var(--line-2);
  }
  tr.me td {
    background: rgb(29 47 94 / 0.05);
  }
  tr.won td {
    color: var(--fuchsia);
    font-weight: 700;
  }
  .place {
    width: 2.4em;
    font-weight: 700;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .name span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    width: 24%;
  }
  .sum {
    font-weight: 700;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
</style>
