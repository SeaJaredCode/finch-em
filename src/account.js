// Accounts (itch-13, d-31): the credential a user may attach to their anonymous identity, and the
// five transitions that move a browser or a profile between users. Every rule about who may do
// what lives here, not in the routes:
//   register     attach a username and password to req.userId (the session does not change)
//   signIn       become another user, proven by password; one answer for every failure
//   signOut      revoke this browser's session; back to the household user if there is one
//   listLegacy / claimLegacy   a registered user takes a pre-auth profile (user_id NULL), one shot
//   split        give one of my profiles to the account named — new if the username is free, else
//                the existing one proven by its password — and become it
// The store primitives behind them (setCredential, claimProfile, moveProfile) are single conditional
// UPDATEs; nothing here copies or deletes data, and nothing ever returns a password hash.
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getStore } from './store/index.js';
import { replaceSession, revokeSession, sessionView } from './auth.js';

const scrypt = promisify(scryptCallback);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AccountError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** `scrypt$N$r$p$salt$hash` (base64url), so the parameters can change later without a migration. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password, stored) {
  const [algo, N, r, p, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(String(password), Buffer.from(salt, 'base64url'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Verified when the username is unknown, so a failed sign-in costs the same time either way.
const DUMMY_HASH = hashPassword('not-a-real-password');

export function normalizeUsername(value) {
  const username = typeof value === 'string' ? value.trim() : '';
  if (!USERNAME_RE.test(username)) {
    throw new AccountError(400, 'username must be 3 to 32 letters, digits, dots, dashes or underscores, starting with a letter or digit');
  }
  return { username, usernameKey: username.toLowerCase() };
}

export function checkPassword(value) {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN) throw new AccountError(400, `password must be at least ${PASSWORD_MIN} characters`);
  if (value.length > PASSWORD_MAX) throw new AccountError(400, `password must be at most ${PASSWORD_MAX} characters`);
  return value;
}

export async function requireRegistered(store, userId) {
  const user = await store.getUser(userId);
  if (!user || !user.username) throw new AccountError(403, 'sign in or create an account first');
  return user;
}

/**
 * A new password set by someone else — a teacher of one of the user's classes (d-32); src/classes.js
 * decides who may call this. Validate, hash, store, then sign the user out everywhere (browsers that
 * remember a household user go back to it, the rest lose their cookie).
 */
export async function resetPassword(store, userId, password) {
  const passwordHash = await hashPassword(checkPassword(password));
  const user = await store.setPassword(userId, passwordHash);
  if (!user) throw new AccountError(404, 'user not found');
  const revokedSessions = await store.revokeUserSessions(userId);
  return { user, revokedSessions };
}

const TAKEN = () => new AccountError(409, 'that username is taken');
const ALREADY = () => new AccountError(409, 'this computer already has an account; sign out first to create another');

/** POST /account/register { username, password }: attach a credential to the caller's user. */
export async function register(req, res, body) {
  const store = getStore();
  const { username, usernameKey } = normalizeUsername(body.username);
  const password = checkPassword(body.password);
  const current = await store.getUser(req.userId);
  if (current && current.username) throw ALREADY();
  let user;
  try {
    user = await store.setCredential(req.userId, { username, usernameKey, passwordHash: await hashPassword(password) });
  } catch (err) {
    if (err && err.code === 'USERNAME_TAKEN') throw TAKEN();
    throw err;
  }
  if (!user) throw ALREADY();
  return sessionView(store, req.userId);
}

/** POST /account/signin { username, password }: become that user. Every failure gets the same answer. */
export async function signIn(req, res, body) {
  const store = getStore();
  const wrong = new AccountError(401, 'wrong username or password');
  let usernameKey;
  try {
    ({ usernameKey } = normalizeUsername(body.username));
  } catch {
    throw wrong;
  }
  const credential = await store.findCredential(usernameKey);
  const ok = await verifyPassword(typeof body.password === 'string' ? body.password : '', credential ? credential.passwordHash : await DUMMY_HASH);
  if (!credential || !ok) throw wrong;
  if (credential.userId !== req.userId) await replaceSession(req, res, store, credential.userId);
  return sessionView(store, credential.userId);
}

/** POST /account/signout: revoke this browser's session; back to the household user if there is one. */
export async function signOut(req, res) {
  const store = getStore();
  const session = await revokeSession(req, res, store);
  return session ? sessionView(store, session.userId) : { userId: null, profiles: [], account: { username: null } };
}

/** GET /account/legacy: the pre-auth profiles a registered user may claim (name and colour only). */
export async function listLegacy(req) {
  const store = getStore();
  await requireRegistered(store, req.userId);
  return store.listUnclaimedProfiles();
}

/** POST /account/legacy/:id/claim: take a pre-auth profile; 404 once anyone has claimed it. */
export async function claimLegacy(req, profileId) {
  const store = getStore();
  await requireRegistered(store, req.userId);
  if (!UUID_RE.test(String(profileId))) throw new AccountError(404, 'profile not found');
  const profile = await store.claimProfile(String(profileId), req.userId);
  if (!profile) throw new AccountError(404, 'profile not found');
  return profile;
}

/**
 * POST /account/split { profileId, username, password }: give one of my profiles to the account
 * named and become it. Two-sided consent: my session proves the source (req.scope only sees my
 * profiles), the password proves an existing target, and a free username makes a new one.
 * Programs, floors, runs, drawings and workbook entries follow the profile by foreign key.
 */
export async function split(req, res, body) {
  const store = getStore();
  const source = UUID_RE.test(String(body.profileId)) ? await req.scope.getProfile(String(body.profileId)) : null;
  if (!source) throw new AccountError(404, 'profile not found');
  const { username, usernameKey } = normalizeUsername(body.username);
  const password = checkPassword(body.password);
  const credential = await store.findCredential(usernameKey);
  let targetId;
  if (credential) {
    if (!(await verifyPassword(password, credential.passwordHash))) throw new AccountError(401, 'wrong username or password');
    targetId = credential.userId;
  } else {
    try {
      targetId = (await store.createUser({ username, usernameKey, passwordHash: await hashPassword(password) })).id;
    } catch (err) {
      if (err && err.code === 'USERNAME_TAKEN') throw TAKEN();
      throw err;
    }
  }
  if (targetId === req.userId) throw new AccountError(409, 'that profile is already in this account');
  const moved = await store.moveProfile(source.id, req.userId, targetId);
  if (!moved) throw new AccountError(404, 'profile not found');
  await replaceSession(req, res, store, targetId);
  return { ...(await sessionView(store, targetId)), profile: moved };
}
