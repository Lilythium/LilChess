<script lang="ts">
  import { login, register } from "../lib/auth.svelte";
  import { LoginBody, RegisterBody } from "@lilchess/shared";
  import { validate } from "../lib/validate";

  let mode = $state<"login" | "register">("login");
  let username = $state("");
  let password = $state("");
  let inviteCode = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    const input = { username, password, inviteCode: inviteCode.trim() || undefined };
    try {
      if (mode === "login") {
        const v = validate(LoginBody, input);
        if (!v.ok) { error = v.error; return; }
        await login(v.data.username, v.data.password);
      } else {
        const v = validate(RegisterBody, input);
        if (!v.ok) { error = v.error; return; }
        await register(v.data.username, v.data.password, v.data.inviteCode);
      }
      // App.svelte redirects once auth.user is set
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="panel card">
  <h1>{mode === "login" ? "Log in" : "Register"}</h1>
  <form onsubmit={submit}>
    <input placeholder="Username" autocomplete="username" bind:value={username} required />
    <input type="password" placeholder="Password" bind:value={password} required
           autocomplete={mode === "login" ? "current-password" : "new-password"} />
    {#if mode === "register"}
      <input placeholder="Invite code (if required)" bind:value={inviteCode} />
      <span class="muted">Password must be at least 8 characters.</span>
    {/if}
    {#if error}<span class="error">{error}</span>{/if}
    <button class="primary" disabled={busy}>{mode === "login" ? "Log in" : "Create account"}</button>
  </form>
  <p class="muted">
    {mode === "login" ? "No account?" : "Already registered?"}
    <button class="link" type="button" onclick={() => (mode = mode === "login" ? "register" : "login")}>
      {mode === "login" ? "Register" : "Log in"}
    </button>
  </p>
</div>

<style>
  .card { max-width: 340px; margin: 4rem auto; }
  form { display: flex; flex-direction: column; gap: 0.75rem; }
  .link { background: none; padding: 0; color: var(--blue); }
  .link:hover:not(:disabled) { background: none; text-decoration: underline; }
</style>