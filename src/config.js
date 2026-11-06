// ─────────────────────────────────────────────────────────────────────────────
//  App configuration. Everything here comes from environment variables set in
//  a `.env` file (see .env.example and SETUP.md). With no Firebase config the
//  app runs in DEMO MODE: data lives only in this browser.
// ─────────────────────────────────────────────────────────────────────────────
const env = import.meta.env || {};

export const APP_NAME = env.VITE_APP_NAME || 'Penteint Projects';
export const APP_TAGLINE = env.VITE_APP_TAGLINE || 'Plan, track and review team progress';

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: env.VITE_FIREBASE_PROJECT_ID || '',
  appId: env.VITE_FIREBASE_APP_ID || '',
};

// Optional integrations (leave blank to hide them)
export const GOOGLE_CLIENT_ID = env.VITE_GOOGLE_CLIENT_ID || '';   // Google Drive, Sheets and Calendar
export const MS_CLIENT_ID = env.VITE_MS_CLIENT_ID || '';           // Upload straight to OneDrive (Microsoft Graph). Needs user consent to Files.ReadWrite.
// "Continue with Microsoft": turned on separately, once the Microsoft provider is set up in Firebase.
// It only asks for basic sign-in (name and email), which most universities let students approve.
export const ENABLE_MS_SIGNIN = env.VITE_MS_SIGNIN === 'true';

export const USE_EMULATORS = env.VITE_USE_EMULATORS === 'true';
// App Check: proves requests come from this website (reCAPTCHA Enterprise site key; public). Empty = off.
export const APPCHECK_SITE_KEY = env.VITE_RECAPTCHA_SITE_KEY || '';

// "Email me a sign-in link". Off by default: Firebase's free Spark plan sends at most
// 5 of these emails per day for the whole site. Turn on after upgrading to Blaze.
export const ENABLE_EMAIL_LINK = env.VITE_ENABLE_EMAIL_LINK === 'true';

// "Confirm your university email with a code" for students signed in with a personal email.
// Needs the Cloud Functions in functions/ (Blaze plan). Turn on after deploying them.
export const STUDENT_EMAIL_CHECK = env.VITE_STUDENT_EMAIL_CHECK === 'true';
// The server (Cloud Functions + Resend) emails invitations itself. On whenever the functions are deployed.

// The public demo on the real site: /demo (in-browser data only, a sample team and a guided tour).
export const PUBLIC_DEMO = typeof location !== 'undefined' && /(^|\/)demo(\.html)?\/?$/.test(location.pathname);
// Demo mode = no Firebase project configured, ?demo in the URL, or the public demo page.
export const DEMO_MODE = !firebaseConfig.apiKey || !firebaseConfig.projectId || PUBLIC_DEMO ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo'));
/** Invitation emails are sent by the server (emailInvites function); the demo simulates it. */
export const SERVER_EMAILS = env.VITE_SERVER_EMAILS === 'true' || STUDENT_EMAIL_CHECK || DEMO_MODE;

export const LIMITS = {
  logoBytes: 150_000,        // team logo, stored inside the team document
  avatarBytes: 40_000,       // your account photo, stored in your profile and team memberships
  taskIconBytes: 25_000,     // per-task icon
  historyEntries: 100,       // per-task history kept in the task document
  taskTitle: 500,
  phasesPerTeam: 20,
  commentChars: 2000,
  mentionsPerComment: 20,
  fieldsPerTeam: 30,
  rolesPerTeam: 20,
};
