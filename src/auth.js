// Browser sessions (itch-12 phase 1, d-29; accounts d-31). A session is an opaque random token in
// an HttpOnly cookie; the store keeps only its sha256. requireSession turns the cookie into
// req.userId, req.session and req.scope — a store that only sees the user's own profiles
// (src/store/scoped.js) — so a route can never name a row outside the caller's workspaces. A
// browser that arrives without a cookie is a new anonymous user; src/account.js attaches a
// credential later and moves the browser between users with the three primitives below.
import { createHash, randomBytes } from 'node:crypto';
import { getStore } from './store/index.js';
import { scopedStore } from './store/scoped.js';
import { seedProfile } from './seed.js';

export const COOKIE = 'finch_session';
const MAX_AGE_S = 400 * 24 * 3600; // browsers cap a cookie's life at 400 days
const TOUCH_MS = 24 * 3600 * 1000; // slide the expiry forward at most once a day
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // base64url of 32 bytes
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Cookie header as { name: value }; a few lines instead of a dependency. */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    let value = part.slice(i + 1).trim();
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const expiry = () => new Date(Date.now() + MAX_AGE_S * 1000).toISOString();

// Secure follows the scheme the load balancer reports (app.set('trust proxy', 1) in src/app.js).
const cookieOptions = (req) => ({ httpOnly: true, sameSite: 'lax', path: '/', secure: req.secure });

function setCookie(req, res, token) {
  res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: MAX_AGE_S * 1000 });
}

function clearCookie(req, res) {
  res.clearCookie(COOKIE, cookieOptions(req));
}

/** The live session named by the request's cookie, with the raw token, or null. */
async function findSession(req, store) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token || !TOKEN_RE.test(token)) return null;
  const session = await store.getSession(hashToken(token));
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return { session, token };
}

// ---- the three session primitives (d-31) ----------------------------------------------------

/** Create a session row for `userId` and hand its token to the browser. */
export async function mintSession(req, res, store, { userId, homeUserId = null }) {
  const token = randomBytes(32).toString('base64url');
  const session = await store.createSession({ tokenHash: hashToken(token), userId, homeUserId, expiresAt: expiry() });
  setCookie(req, res, token);
  return session;
}

/**
 * Move this browser to another user (sign-in, split). The session it held is revoked. If that
 * session belonged to an anonymous user — the household on a shared computer, which has no way
 * to sign back in — the new session remembers it as home so sign-out can return there; a
 * registered user needs no such memory because they can always sign in again.
 */
export async function replaceSession(req, res, store, targetUserId) {
  const prev = req.session;
  let homeUserId = null;
  if (prev) {
    if (prev.homeUserId) {
      homeUserId = prev.homeUserId;
    } else {
      const user = await store.getUser(prev.userId);
      if (user && !user.username) homeUserId = prev.userId;
    }
    await store.deleteSession(prev.tokenHash);
  }
  if (homeUserId === targetUserId) homeUserId = null;
  return mintSession(req, res, store, { userId: targetUserId, homeUserId });
}

/** Revoke this browser's session; return to its home user if it has one, else clear the cookie. */
export async function revokeSession(req, res, store) {
  const prev = req.session;
  if (prev) await store.deleteSession(prev.tokenHash);
  if (prev && prev.homeUserId && (await store.getUser(prev.homeUserId))) {
    return mintSession(req, res, store, { userId: prev.homeUserId });
  }
  clearCookie(req, res);
  return null;
}

/**
 * What the client learns about a user: their profiles and who they are signed in as. A user
 * emptied by splits (or an account whose every profile moved away) gets the first-visit workspace
 * again, so no browser ever boots into nothing.
 */
export async function sessionView(store, userId) {
  const user = await store.getUser(userId);
  let profiles = await store.listProfiles(userId);
  if (!profiles.length) {
    await seedProfile(store, userId);
    profiles = await store.listProfiles(userId);
  }
  return { userId, profiles, account: { username: user && user.username ? user.username : null } };
}

/**
 * POST /api/session: resume the cookie's session, or mint a user and a session for this browser.
 * A new user claims the pre-session profile the browser remembers (localStorage, d-6) if that row
 * is still unclaimed; otherwise it gets a fresh 'Student' workspace with the sample program, which
 * is exactly what a first visit showed before sessions existed.
 */
export async function startSession(req, res, { rememberedProfileId } = {}) {
  const store = getStore();
  const found = await findSession(req, store);
  let userId;
  if (found) {
    userId = found.session.userId;
  } else {
    const user = await store.createUser();
    userId = user.id;
    const remembered = typeof rememberedProfileId === 'string' && UUID_RE.test(rememberedProfileId) ? rememberedProfileId : null;
    const claimed = remembered ? await store.claimProfile(remembered, userId) : null;
    if (!claimed) await seedProfile(store, userId);
    await mintSession(req, res, store, { userId });
  }
  return sessionView(store, userId);
}

/** Express middleware: 401 without a live session; otherwise req.userId, req.session and req.scope are set. */
export async function requireSession(req, res, next) {
  try {
    const store = getStore();
    const found = await findSession(req, store);
    if (!found) {
      res.status(401).json({ error: 'no session' });
      return;
    }
    const { session, token } = found;
    if (Date.now() - new Date(session.lastSeenAt).getTime() > TOUCH_MS) {
      await store.touchSession(session.tokenHash, expiry());
      setCookie(req, res, token);
    }
    req.userId = session.userId;
    req.session = session;
    req.scope = await scopedStore(store, session.userId);
    next();
  } catch (err) {
    next(err);
  }
}
