// Chooses the backend: real Firebase when configured, otherwise the in-browser demo.
import { DEMO_MODE } from '../config.js';

export async function loadBackend() {
  // Test hook: browser tests can inject a fake backend to exercise screens that need a real server.
  if (typeof window !== 'undefined' && window.__TT_TEST_BACKEND__) return window.__TT_TEST_BACKEND__;
  return DEMO_MODE ? import('./demo.js') : import('./firebase.js');
}
