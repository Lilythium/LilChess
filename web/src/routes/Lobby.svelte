<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { navigate } from "../lib/router.svelte";
  import { displayName, timeControl } from "../lib/format";
    import { hasResumableLocalGame, startLocalGame } from "../lib/game/localGame";
  import type { ChallengeRow, Challenges, MyGames } from "../lib/types";
  import HoverDropdown from "../lib/components/HoverDropdown.svelte";
  import ModeToggle from "../lib/components/ModeToggle.svelte";
  import { ChallengeBody, VARIANTS, VARIANT_LABELS, type Variant } from "@lilchess/shared";
  import { validate } from "../lib/validate";
  import { playSound } from "../lib/audio/audio";

  const PRESETS: [number, number][] = [[1, 0], [3, 2], [5, 3], [10, 0], [15, 10]];
  const DAYS = [1, 2, 3, 7, 14];
  const VARIANT_OPTIONS = VARIANTS.map((value: Variant) => ({
    value,
    label: VARIANT_LABELS[value],
  }));

  let variant = $state<Variant>("standard");
  let localVariant = $state<Variant>("standard");

  let mode = $state<"live" | "correspondence">("live");
  let preset = $state(2); // 5+3
  let days = $state(3);
  let color = $state<"random" | "white" | "black">("random");
  let toUsername = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);
  let challenges = $state<Challenges>({ mine: [], forMe: [], open: [] });
  let inviteUrl = $state<string | null>(null);

  // Play on this device
  let localPreset = $state<number | null>(2); // index into PRESETS; null = no clock
  const hasLocal = hasResumableLocalGame();

  // Games that existed on first load; anything new means one of my challenges was accepted.
  let known: Set<string> | null = null;

  const linkFor = (id: string) => `${location.origin}/#/c/${id}`;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // insecure context (plain http on a LAN): the user copies from the field
    }
  }

  async function refresh() {
    try {
      const [c, g] = await Promise.all([
        api<Challenges>("/api/challenges"),
        api<MyGames>("/api/games/my-games"),
      ]);

      challenges = c;

      const started = [...g.myTurn, ...g.theirTurn].map((r) => r.id);

      if (known === null) {
        known = new Set(started);
      } else {
        const seen = known;
        const fresh = started.find((id) => !seen.has(id));

        if (fresh) {
          navigate(`/game/${fresh}`);
        }
      }
    } catch {
      // transient; next poll will retry
    }
  }

  onMount(() => {
    void refresh();

    const t = setInterval(refresh, 3000);

    return () => clearInterval(t);
  });

  async function create(asLink = false) {
    busy = true;
    error = null;

    const [min, inc] = PRESETS[preset]!;

    const clock =
      mode === "live"
        ? {
            mode,
            initialMs: min * 60_000,
            incrementMs: inc * 1000,
          }
        : {
            mode,
            daysPerMove: days,
          };

    try {
      const v = validate(ChallengeBody, {
        ...clock,
        colorPref: color === "random" ? undefined : color,
        toUsername: asLink ? undefined : toUsername.trim() || undefined,
        link: asLink || undefined, variant: variant === "standard" ? undefined : variant,
      });

      if (!v.ok) {
        error = v.error;
        return;
      }

      const r = await api<{ challengeId: string }>("/api/challenges", {
        body: v.data,
      });

      toUsername = "";
      inviteUrl = linkFor(r.challengeId);

      void copy(inviteUrl);

      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function accept(id: string) {
    error = null;

    try {
      const r = await api<{ gameId: string }>(`/api/challenges/${id}/accept`, {
        method: "POST",
      });

      navigate(`/game/${r.gameId}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await refresh();
    }
  }

  async function cancel(id: string) {
    try {
      await api(`/api/challenges/${id}`, {
        method: "DELETE",
      });
    } finally {
      await refresh();
    }
  }

  function playLocal() {
    const p = localPreset === null ? null : PRESETS[localPreset]!;

    startLocalGame(
      p
        ? { minutes: p[0], incrementSec: p[1], variant: localVariant }
        : { minutes: null, incrementSec: 0, variant: localVariant },
    );

    playSound("gameStart");
    navigate("/local");
  }
</script>

{#snippet list(
  title: string,
  rows: ChallengeRow[],
  label: string,
  action: (id: string) => void,
  showFrom: boolean,
  copyable = false
)}
  <div class="panel">
    <h2>{title}</h2>

    {#if rows.length === 0}
      <p class="muted">Nothing here.</p>
    {:else}
      <table>
        <tbody>
          {#each rows as c (c.id)}
            <tr>
              {#if showFrom}
                <td>{displayName(c.from_name)}</td>
              {/if}

              <td>
                {timeControl(c)}
                {c.is_link ? " · Private" : " · Open"}
              </td>

              <td>
                {c.color_pref
                  ? `you: ${c.color_pref === "white" ? "black" : "white"}`
                  : ""}
              </td>

              <td style="text-align:right">
                <button onclick={() => action(c.id)}>{label}</button>

                {#if copyable}
                  <button onclick={() => copy(linkFor(c.id))}>Copy link</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{/snippet}

<div class="grid">
  <div class="stack">
    {#if !auth.user?.is_guest}
      <div class="panel">
        <div class="row">
          <h2>Create a game</h2>
        </div>
        <div class="row">
          <ModeToggle bind:value={mode} />
          <HoverDropdown
            bind:value={variant}
            options={VARIANT_OPTIONS}
            label="Game variant"
            width="33%"
          />
        </div>
        <span class="muted" style="display: block; margin: .5rem;">
          Creating a new {mode} challenge replaces your current one.
        </span>
        <div class="stack">
          {#if mode === "live"}
            <div class="row">
              {#each PRESETS as [m, i], idx (idx)}
                <button
                  class:primary={preset === idx}
                  onclick={() => (preset = idx)}
                >
                  {m}+{i}
                </button>
              {/each}
            </div>
          {:else}
            <select bind:value={days}>
              {#each DAYS as d (d)}
                <option value={d}>
                  {d} day{d === 1 ? "" : "s"} per move
                </option>
              {/each}
            </select>
          {/if}

          <div class="row">
            <button
              class:primary={color === "white"}
              onclick={() => (color = "white")}
            >
              White
            </button>

            <button
              class:primary={color === "random"}
              onclick={() => (color = "random")}
            >
              Random
            </button>

            <button
              class:primary={color === "black"}
              onclick={() => (color = "black")}
            >
              Black
            </button>
          </div>

          <input
            placeholder="Challenge a specific user (optional)"
            bind:value={toUsername}
          />

          {#if error}
            <span class="error">{error}</span>
          {/if}

          <div class="row">
            <button
              class="primary"
              disabled={busy}
              onclick={() => create()}
            >
              Create
            </button>

            <button
              disabled={busy}
              onclick={() => create(true)}
            >
              Create private challenge
            </button>
          </div>
        </div>
      </div>
    {:else}
      <div class="panel">
        <h2>Guest account</h2>

        <p class="muted">
          Guests can accept challenges and play, but can't create them.
        </p>

        {#if error}
          <span class="error">{error}</span>
        {/if}
      </div>
    {/if}

    <div class="panel">
      <h2>Play on this device</h2>

      <div class="stack">
        <div class="row">
          {#each PRESETS as [m, i], idx (idx)}
            <button
              class:primary={localPreset === idx}
              onclick={() => (localPreset = idx)}
            >
              {m}+{i}
            </button>
          {/each}

          <button
            class:primary={localPreset === null}
            onclick={() => (localPreset = null)}
          >
            No clock
          </button>
        </div>

        <div class="row">
          <button class="primary" onclick={playLocal}>
            Start
          </button>

          {#if hasLocal}
            <button onclick={() => navigate("/local")}>
              Resume current game
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <div class="stack">
    {@render list(
      "Open challenges",
      challenges.open,
      "Accept",
      accept,
      true
    )}

    {#if challenges.forMe.length > 0}
      {@render list(
        "Challenges for you",
        challenges.forMe,
        "Accept",
        accept,
        true
      )}
    {/if}

    {#if challenges.mine.length > 0}
      {@render list(
        "Your challenges",
        challenges.mine,
        "Cancel",
        cancel,
        false,
        true
      )}
    {/if}
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    align-items: start;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  @media (max-width: 800px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>