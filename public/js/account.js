// The account button and dialog in the header (itch-13, d-31). "Who am I" for the page: an
// anonymous user sees Sign in, Create an account for this computer, and Take this profile to my
// own account; a registered user sees their name, Sign out, and the older profiles they may claim.
// Every successful action reloads the page: boot runs POST /api/session again and lands in
// whatever user the server just handed this browser, so no pane needs a second entry path.
import { api } from './api.js';

const STORAGE_KEY = 'finch-sandbox.profileId';

export function createAccount({ els, profiles, onError }) {
  const { button, dialog } = els;
  const $ = (selector) => dialog.querySelector(selector);
  const form = $('.account-form');
  const title = $('.account-title');
  const anon = $('.account-anon');
  const signed = $('.account-signed');
  const legacyWrap = $('.account-legacy-wrap');
  const legacyList = $('.account-legacy');
  const msg = $('.account-msg');

  function remember(id) {
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* private mode */
    }
  }
  const reload = () => location.reload();
  function fail(err) {
    msg.textContent = err.message;
    msg.hidden = false;
  }
  const buttons = () => form.querySelectorAll('button');
  const setBusy = (busy) => {
    for (const b of buttons()) b.disabled = busy;
  };

  /** The header button: "Sign in" for an anonymous user, the username once signed in. */
  function render() {
    const { username } = profiles.account || {};
    button.textContent = username || 'Sign in';
    button.title = username ? 'Your account: sign out or claim an older profile' : 'Sign in or create an account';
  }

  function legacyRow(p) {
    const row = document.createElement('div');
    row.className = 'legacy-row';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = p.color;
    const name = document.createElement('span');
    name.className = 'legacy-name';
    name.textContent = p.name;
    const claim = document.createElement('button');
    claim.type = 'button';
    claim.textContent = 'Claim';
    claim.title = 'Make this profile, and everything in it, part of your account';
    claim.addEventListener('click', async () => {
      claim.disabled = true;
      try {
        const claimed = await api.claimLegacy(p.id);
        remember(claimed.id);
        reload();
      } catch (err) {
        claim.disabled = false;
        fail(err);
      }
    });
    row.append(swatch, name, claim);
    return row;
  }

  async function open() {
    const { username } = profiles.account || {};
    msg.hidden = true;
    anon.hidden = !!username;
    signed.hidden = !username;
    if (username) {
      title.textContent = 'Signed in as ' + username;
      legacyList.innerHTML = '';
      legacyWrap.hidden = true;
      try {
        const rows = await api.listLegacy();
        if (rows.length) {
          legacyWrap.hidden = false;
          for (const p of rows) legacyList.appendChild(legacyRow(p));
        }
      } catch (err) {
        fail(err);
      }
    } else {
      title.textContent = 'Your account';
      $('.split-name').textContent = profiles.current ? profiles.current.name : 'this profile';
      form.reset();
      setBusy(false);
    }
    if (!dialog.open) dialog.showModal();
  }

  button.addEventListener('click', () => open().catch((err) => onError && onError(err.message)));
  $('.account-close').addEventListener('click', () => dialog.close());

  // The three intents share one username and password; the button that was pressed says which.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const intent = e.submitter ? e.submitter.value : 'signin';
    const body = { username: form.elements.username.value, password: form.elements.password.value };
    setBusy(true);
    try {
      if (intent === 'register') {
        await api.register(body);
      } else if (intent === 'split') {
        const result = await api.split({ ...body, profileId: profiles.current ? profiles.current.id : null });
        remember(result.profile.id);
      } else {
        await api.signIn(body);
        remember(null); // the remembered profile belonged to the user we just left
      }
      reload();
    } catch (err) {
      setBusy(false);
      fail(err);
    }
  });

  $('.account-signout').addEventListener('click', async () => {
    try {
      await api.signOut();
      remember(null);
      reload();
    } catch (err) {
      fail(err);
    }
  });

  return { render, open };
}
