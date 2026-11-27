<script>
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { getCurrentUser, getErrorMessage, loginAccount, registerAccount, AuthError } from '$lib/auth';

  let mode = page.url.searchParams.get('mode') === 'register' ? 'register' : 'login';
  let name = '';
  let email = '';
  let password = '';
  let confirmPassword = '';
  let message = '';
  let busy = false;

  onMount(async () => {
    try {
      await getCurrentUser();
      await goto('/dashboard');
    } catch (error) {
      if (!(error instanceof AuthError && error.status === 401)) {
        message = getErrorMessage(error);
      }
    }
  });

  /** @param {SubmitEvent} event */
  async function submit(event) {
    event.preventDefault();
    message = '';

    if (mode === 'register' && password !== confirmPassword) {
      message = 'Passwords do not match';
      return;
    }

    busy = true;
    try {
      if (mode === 'register') {
        await registerAccount({ name, email, password });
      } else {
        await loginAccount({ email, password });
      }
      await goto('/dashboard');
    } catch (error) {
      message = getErrorMessage(error);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{mode === 'register' ? 'Create account' : 'Sign in'} | HRMS Portal</title>
</svelte:head>

<main class="container">
  <section class="card">
    <h1>{mode === 'register' ? 'Create your account' : 'Sign in'}</h1>
    <p class="intro">Use your email address and a password to access the HRMS portal.</p>

    <form onsubmit={submit}>
      {#if mode === 'register'}
        <label>
          Full name
          <input bind:value={name} name="name" autocomplete="name" maxlength="100" required />
        </label>
      {/if}

      <label>
        Email
        <input bind:value={email} name="email" type="email" autocomplete="email" maxlength="254" required />
      </label>

      <label>
        Password
        <input
          bind:value={password}
          name="password"
          type="password"
          autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
          minlength={mode === 'register' ? 12 : undefined}
          required
        />
      </label>

      {#if mode === 'register'}
        <label>
          Confirm password
          <input
            bind:value={confirmPassword}
            name="confirmPassword"
            type="password"
            autocomplete="new-password"
            minlength="12"
            required
          />
        </label>
      {/if}

      {#if message}
        <p class="message" role="alert">{message}</p>
      {/if}

      <button type="submit" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
      </button>
    </form>

    <p class="switch-mode">
      {#if mode === 'register'}
        Already have an account? <a href="/login">Sign in</a>
      {:else}
        New to HRMS? <a href="/login?mode=register">Create an account</a>
      {/if}
    </p>
  </section>
</main>

<style>
  .container { max-width: 480px; margin: 3rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; }
  .card { padding: 2rem; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
  h1 { margin-top: 0; }
  .intro { color: #4a5568; }
  form { display: grid; gap: 1rem; margin-top: 1.5rem; }
  label { display: grid; gap: 0.4rem; font-weight: 600; }
  input { box-sizing: border-box; width: 100%; padding: 0.7rem; border: 1px solid #a0aec0; border-radius: 4px; font: inherit; }
  button { padding: 0.75rem; border: 0; border-radius: 4px; background: #319795; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: 0.65; cursor: wait; }
  .message { margin: 0; color: #c53030; }
  .switch-mode { margin-bottom: 0; }
</style>
