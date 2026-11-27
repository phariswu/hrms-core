const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001/api/v1';

export class AuthError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** @param {string} path @param {RequestInit} [options] */
async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new Error('Unable to reach the authentication service');
  }

  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new AuthError(body?.error || 'Authentication request failed', response.status);
  }

  return body;
}

/** @param {{ name: string, email: string, password: string }} account */
export function registerAccount({ name, email, password }) {
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password })
  });
}

/** @param {{ email: string, password: string }} account */
export function loginAccount({ email, password }) {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
}

export function getCurrentUser() {
  return request('/auth/me');
}

/** @param {string} pageKey */
export function checkPageAccess(pageKey) {
  return request(`/pages/${encodeURIComponent(pageKey)}/access`);
}

export function logoutAccount() {
  return request('/auth/logout', { method: 'POST' });
}

export function getAdminData() {
  return Promise.all([
    request('/admin/permissions'),
    request('/admin/groups'),
    request('/admin/users')
  ]).then(([permissionData, groupData, userData]) => ({
    permissions: permissionData.permissions,
    groups: groupData.groups,
    users: userData.users
  }));
}

/** @param {string} name */
export function createGroup(name) {
  return request('/admin/groups', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
}

/** @param {string} groupId @param {string[]} permissionKeys */
export function updateGroupPermissions(groupId, permissionKeys) {
  return request(`/admin/groups/${encodeURIComponent(groupId)}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissionKeys })
  });
}

/** @param {string} userId @param {string[]} groupIds */
export function updateUserGroups(userId, groupIds) {
  return request(`/admin/users/${encodeURIComponent(userId)}/groups`, {
    method: 'PUT',
    body: JSON.stringify({ groupIds })
  });
}

/** @param {unknown} error */
export function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'An unexpected error occurred';
}
