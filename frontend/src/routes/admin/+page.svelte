<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    AuthError,
    createGroup,
    getAdminData,
    getErrorMessage,
    getCurrentUser,
    updateGroupPermissions,
    updateUserGroups
  } from '$lib/auth';

  type Permission = { permission_key: string; description: string };
  type Group = { id: string; name: string; permissions: { key: string; description: string }[] };
  type User = { id: string; name: string; email: string; groups: { id: string; name: string }[] };

  let permissions: Permission[] = [];
  let groups: Group[] = [];
  let users: User[] = [];
  let selectedGroupId = '';
  let selectedUserId = '';
  let selectedPermissionKeys: string[] = [];
  let selectedGroupIds: string[] = [];
  let newGroupName = '';
  let message = '';
  let busy = false;

  async function loadAdminData() {
    const data = await getAdminData();
    permissions = data.permissions;
    groups = data.groups;
    users = data.users;
    if (!selectedGroupId && groups.length) selectedGroupId = String(groups[0].id);
    if (!selectedUserId && users.length) selectedUserId = String(users[0].id);
    syncSelectedGroup();
    syncSelectedUser();
  }

  function syncSelectedGroup() {
    const group = groups.find((item) => String(item.id) === selectedGroupId);
    selectedPermissionKeys = group?.permissions.map((permission) => permission.key) || [];
  }

  function syncSelectedUser() {
    const user = users.find((item) => String(item.id) === selectedUserId);
    selectedGroupIds = user?.groups.map((group) => String(group.id)) || [];
  }

  onMount(async () => {
    try {
      const { permissions: userPermissions } = await getCurrentUser();
      if (!userPermissions.includes('admin.manage')) {
        await goto('/dashboard');
        return;
      }
      await loadAdminData();
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) {
        await goto('/login');
      } else {
        message = getErrorMessage(error);
      }
    }
  });

  async function addGroup(event: SubmitEvent) {
    event.preventDefault();
    message = '';
    busy = true;
    try {
      await createGroup(newGroupName);
      newGroupName = '';
      await loadAdminData();
      message = 'Group created.';
    } catch (error) {
      message = getErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function savePermissions() {
    message = '';
    busy = true;
    try {
      await updateGroupPermissions(selectedGroupId, selectedPermissionKeys);
      await loadAdminData();
      message = 'Group permissions saved.';
    } catch (error) {
      message = getErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function saveUserGroups() {
    message = '';
    busy = true;
    try {
      await updateUserGroups(selectedUserId, selectedGroupIds);
      await loadAdminData();
      message = 'User groups saved.';
    } catch (error) {
      message = getErrorMessage(error);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Group and user administration | HRMS Portal</title>
</svelte:head>

<main class="container">
  <header>
    <div>
      <h1>Administration</h1>
      <p>Manage access through groups and page permissions.</p>
    </div>
    <a href="/dashboard">Back to dashboard</a>
  </header>

  {#if message}
    <p class="message" role="status">{message}</p>
  {/if}

  <section class="card">
    <h2>Groups</h2>
    <form class="new-group" onsubmit={addGroup}>
      <label>
        Create group
        <input bind:value={newGroupName} maxlength="60" required />
      </label>
      <button type="submit" disabled={busy}>Create group</button>
    </form>

    {#if groups.length}
      <label class="select-label">
        Edit group permissions
        <select bind:value={selectedGroupId} onchange={syncSelectedGroup}>
          {#each groups as group}
            <option value={String(group.id)}>{group.name}</option>
          {/each}
        </select>
      </label>
      <fieldset>
        <legend>Permissions</legend>
        {#each permissions as permission}
          <label class="check">
            <input type="checkbox" value={permission.permission_key} bind:group={selectedPermissionKeys} />
            <span><strong>{permission.permission_key}</strong> — {permission.description}</span>
          </label>
        {/each}
      </fieldset>
      <button type="button" disabled={busy} onclick={savePermissions}>Save permissions</button>
    {/if}
  </section>

  <section class="card">
    <h2>Users</h2>
    {#if users.length}
      <label class="select-label">
        Select user
        <select bind:value={selectedUserId} onchange={syncSelectedUser}>
          {#each users as user}
            <option value={String(user.id)}>{user.name} ({user.email})</option>
          {/each}
        </select>
      </label>
      <fieldset>
        <legend>Group memberships</legend>
        {#each groups as group}
          <label class="check">
            <input type="checkbox" value={String(group.id)} bind:group={selectedGroupIds} />
            <span>{group.name}</span>
          </label>
        {/each}
      </fieldset>
      <button type="button" disabled={busy} onclick={saveUserGroups}>Save user groups</button>
    {/if}
  </section>
</main>

<style>
  .container { max-width: 900px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; color: #2d3748; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }
  h1, h2 { margin-top: 0; }
  .card { margin: 1rem 0; padding: 1.5rem; border: 1px solid #e2e8f0; border-radius: 8px; }
  .new-group { display: flex; flex-wrap: wrap; align-items: end; gap: 0.75rem; margin-bottom: 1.5rem; }
  label { display: grid; gap: 0.4rem; }
  input:not([type="checkbox"]), select { min-width: 240px; padding: 0.6rem; border: 1px solid #a0aec0; border-radius: 4px; font: inherit; }
  .select-label { max-width: 480px; margin-bottom: 1rem; }
  fieldset { display: grid; gap: 0.6rem; margin: 1rem 0; border: 1px solid #cbd5e0; border-radius: 4px; }
  .check { display: flex; align-items: flex-start; gap: 0.5rem; }
  .check input { margin-top: 0.35rem; }
  button { padding: 0.65rem 1rem; border: 0; border-radius: 4px; background: #319795; color: white; font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: 0.65; cursor: wait; }
  .message { color: #2f855a; }
</style>
