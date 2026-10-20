<!-- Seconds left until the server's deadline, ticking down; the last ten turn red (and tick, if asked). -->
<script lang="ts">
  import { play } from '../lib/sound.svelte';

  let { left, endsAt, tick = false }: { left: (at: number, now?: number) => number; endsAt: number; tick?: boolean } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });
  const secs = $derived(Math.ceil(left(endsAt, now) / 1000));
  let ticked = -1;
  $effect(() => {
    if (tick && secs > 0 && secs <= 5 && secs !== ticked) {
      ticked = secs;
      play.tick();
    }
  });
</script>

<span class="clock" class:urgent={secs <= 10} role="timer" aria-live="off">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>

<style>
  .clock {
    font: 700 16px/1 var(--face);
    font-variant-numeric: lining-nums tabular-nums;
    letter-spacing: 0.02em;
    padding: 5px 9px 4px;
    border-radius: 6px;
    background: #ffffff;
    color: var(--navy);
  }
  .urgent {
    background: var(--fuchsia);
    color: #ffffff;
  }
</style>
