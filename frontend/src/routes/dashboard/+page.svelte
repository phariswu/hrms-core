<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { AuthError, checkPageAccess, getCurrentUser, getErrorMessage, logoutAccount } from '$lib/auth';

  /** @type {{ id: string, name: string, email: string } | null} */
  let user = null;
  /** @type {string[]} */
  let permissions = [];
  let message = '';

  onMount(async () => {
    try {
      ({ user, permissions } = await getCurrentUser());
      await checkPageAccess('dashboard');
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) {
        await goto('/login');
      } else if (error instanceof AuthError && error.status === 403) {
        message = 'You do not have permission to access the dashboard.';
      } else {
        message = getErrorMessage(error);
      }
    }
  });

  async function signOut() {
    try {
      await logoutAccount();
      await goto('/');
    } catch (error) {
      message = getErrorMessage(error);
    }
  }
</script>

<svelte:head>
  <title>Dashboard | HRMS Portal</title>
</svelte:head>

<div class="dashboard-layout">
  <header>
    <h2>HRMS Core Dashboard</h2>
    {#if user}
      <div class="user-badge">
        <span>{user.name}</span> ({user.email})
        {#if permissions.includes('admin.manage')}
          <a class="admin-link" href="/admin">Admin</a>
        {/if}
        <button class="logout-link" onclick={signOut}>Sign out</button>
      </div>
    {/if}
  </header>

  <main class="content">
    {#if message}
      <p role="alert" class="message">{message}</p>
    {:else if user}
      {#if permissions.includes('page.dashboard')}
        <div class="grid">
          {#if permissions.includes('page.profile')}
            <div class="widget">
              <h3>My Profile</h3>
              <p>View personal details, employment status, and organizational hierarchy.</p>
            </div>
          {/if}
          {#if permissions.includes('page.attendance')}
            <div class="widget">
              <h3>Time & Attendance</h3>
              <p>Log hours, request time off, and manage leave balances.</p>
            </div>
          {/if}
          {#if permissions.includes('page.payroll')}
            <div class="widget">
              <h3>Payroll & Benefits</h3>
              <p>Access payslips, tax forms, and benefit coverage.</p>
            </div>
          {/if}
        </div>
      {:else}
        <p>You do not have permission to access the dashboard.</p>
      {/if}
    {:else}
      <p>Checking your account…</p>
    {/if}
  </main>
</div>

<style>
  .dashboard-layout { font-family: system-ui, sans-serif; padding: 1.5rem; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #edf2f7; padding-bottom: 1rem; }
  .user-badge { font-size: 0.9rem; color: #4a5568; }
  .admin-link { margin-left: 1rem; color: #2b6cb0; }
  .logout-link { margin-left: 1rem; padding: 0; border: 0; background: none; color: #e53e3e; font: inherit; font-weight: 600; cursor: pointer; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-top: 2rem; }
  .widget { padding: 1.5rem; border: 1px solid #e2e8f0; border-radius: 6px; background: #f7fafc; }
  .message { color: #c53030; }
</style>