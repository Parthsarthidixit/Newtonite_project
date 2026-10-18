const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
export const LOGOUT_EVENT = 'newtonite:logout';
export function getToken() { return localStorage.getItem('newtonite_token'); }
export function saveSession(payload) { localStorage.setItem('newtonite_token', payload.token); localStorage.setItem('newtonite_user', JSON.stringify(payload.user)); }
export function saveUser(user) { localStorage.setItem('newtonite_user', JSON.stringify(user)); }
export function clearSession() { localStorage.removeItem('newtonite_token'); localStorage.removeItem('newtonite_user'); }
export function getUser() { try { return JSON.parse(localStorage.getItem('newtonite_user') || 'null'); } catch { return null; } }
export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken(); if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try { response = await fetch(`${API_URL}${path}`, { ...options, headers }); }
  catch { const error = new Error('Cannot reach the server. Check that the API is running.'); error.status = 0; throw error; }
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // An expired/invalid token on any authenticated call signs the user out everywhere in the UI.
    if (response.status === 401 && token && !path.startsWith('/auth/')) { clearSession(); window.dispatchEvent(new Event(LOGOUT_EVENT)); }
    const error = new Error(body.message || 'Request failed'); error.status = response.status; error.code = body.code; throw error;
  }
  return body;
}
