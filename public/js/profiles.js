// The profile switcher in the header. A profile is a named workspace of this browser's user
// (d-29): the session cookie decides whose profiles the server lists, so the picker only ever
// shows this user's own. Whether that user has an account (d-31) is kept here too, for the
// account button in public/js/account.js.
import { api } from './api.js';

const COLORS = ['#2f80ed', '#e91e63', '#2ea043', '#f5a623', '#9b51e0', '#00a3a3'];
const STORAGE_KEY = 'finch-sandbox.profileId';

export function createProfiles({ els, onSwitch, onError }) {
  let profiles = [];
  let account = { username: null };
  let current = null;
  let prefsTimer = null;
  let prefsPatch = {};

  function render() {
    els.select.innerHTML = '';
    for (const p of profiles) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      els.select.appendChild(opt);
    }
    if (current) {
      els.select.value = current.id;
      els.swatch.style.background = current.color;
    }
    // The last profile stays: the server refuses to delete it (d-40), and an account with no
    // profiles is a state nothing here draws.
    const only = profiles.length <= 1;
    els.btnDelete.disabled = only || !current;
    els.btnDelete.title = only
      ? 'Make a second profile before deleting this one'
      : `Delete ${current ? current.name : 'this profile'} and everything in it`;
  }

  async function load() {
    let remembered = null;
    try {
      remembered = localStorage.getItem(STORAGE_KEY);
    } catch {
      remembered = null;
    }
    // Start (or resume) the session first: a brand-new browser claims the remembered pre-session
    // profile if it is still free, otherwise gets a fresh 'Student' workspace; either way the
    // answer is this user's profiles only.
    const session = await api.startSession(remembered || undefined);
    profiles = session.profiles;
    account = session.account || { username: null };
    current = profiles.find((p) => p.id === remembered) || profiles[0] || null;
    render();
    return current;
  }

  function remember() {
    try {
      if (current) localStorage.setItem(STORAGE_KEY, current.id);
    } catch {
      /* private mode */
    }
  }

  async function switchTo(id) {
    const p = profiles.find((x) => x.id === id);
    if (!p || p === current) return;
    await flushPrefs();
    current = p;
    remember();
    render();
    onSwitch && (await onSwitch(current));
  }

  els.select.addEventListener('change', () => switchTo(els.select.value));

  els.btnNew.addEventListener('click', async () => {
    const name = window.prompt('Name for the new profile (for example, a sibling):');
    if (!name || !name.trim()) return;
    try {
      const p = await api.createProfile({ name: name.trim(), color: COLORS[profiles.length % COLORS.length] });
      profiles.push(p);
      render();
      await switchTo(p.id);
    } catch (err) {
      onError && onError('Could not create the profile: ' + err.message);
    }
  });

  // Deleting a profile is irreversible and takes its programs, custom floors, runs, drawings and
  // workbook progress with it, so the name has to be typed rather than a click confirmed. Work
  // already turned in or sent to a teacher belongs to the class and stays (d-40).
  els.btnDelete.addEventListener('click', async () => {
    const victim = current;
    if (!victim || profiles.length <= 1) return;
    const typed = window.prompt(
      `Delete ${victim.name}? Its programs, custom floors, runs, drawings and workbook progress go for good. ` +
        'Anything already turned in or sent to a teacher stays with the class.\n\n' +
        'Type the profile name to confirm:',
    );
    if (typed === null) return;
    if (typed.trim() !== victim.name) {
      onError && onError('That is not the name of the profile, so nothing was deleted.');
      return;
    }
    els.btnDelete.disabled = true;
    try {
      await api.deleteProfile(victim.id);
    } catch (err) {
      render();
      onError && onError('Could not delete the profile: ' + err.message);
      return;
    }
    profiles = profiles.filter((p) => p.id !== victim.id);
    // Any unflushed preference patch belonged to the profile that just went away; dropping it
    // keeps flushPrefs from writing it onto whichever profile we land on.
    prefsPatch = {};
    clearTimeout(prefsTimer);
    current = null;
    await switchTo(profiles[0].id);
  });

  /** Merge a preference patch into the current profile (debounced PATCH). */
  function savePrefs(patch) {
    if (!current) return;
    current.prefs = { ...current.prefs, ...patch };
    prefsPatch = { ...prefsPatch, ...patch };
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(flushPrefs, 400);
  }

  async function flushPrefs() {
    clearTimeout(prefsTimer);
    if (!current || !Object.keys(prefsPatch).length) return;
    const patch = prefsPatch;
    const target = current;
    prefsPatch = {};
    try {
      const saved = await api.updateProfile(target.id, { prefs: patch });
      target.prefs = saved.prefs;
    } catch (err) {
      onError && onError('Could not save preferences: ' + err.message);
    }
  }

  return {
    load,
    switchTo,
    savePrefs,
    flushPrefs,
    get current() {
      return current;
    },
    /** { username } of the signed-in account, or { username: null } for an anonymous user (d-31). */
    get account() {
      return account;
    },
    /** Every profile of the household (the hand-off picker lists the others, d-25). */
    get all() {
      return profiles;
    },
  };
}
