// The Share menu (itch-18, d-39): shareActions() is the client's only copy of the sharing rules.
// The matrix pins what it offers; the agreement test runs the same fixtures against the real server,
// so a rule that changes on one side and not the other fails here.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app.js';
import { resetStoreForTests } from '../src/store/index.js';
import { createMemoryStore } from '../src/store/memory.js';
import { shareActions } from '../public/js/share.js';
import { makeBrowser } from './helpers/browser.js';

let server;
let base;

beforeEach(async () => {
  resetStoreForTests(createMemoryStore());
  await new Promise((resolve, reject) => {
    server = app.listen(0, () => {
      base = 'http://127.0.0.1:' + server.address().port;
      resolve();
    });
    server.once('error', reject);
  });
});

afterEach(async () => {
  resetStoreForTests(null);
  await new Promise((resolve) => server.close(() => resolve()));
});

const cls = (id, role, state, archived = false) => ({ id, name: `Class ${id}`, archivedAt: archived ? '2026-09-01T00:00:00Z' : null, membership: { role, state }, teacher: { username: 'Teach' } });
const ids = (items) => items.map((i) => (i.target ? `${i.id}:${i.target}` : i.id));
const find = (items, id, target) => items.find((i) => i.id === id && (target === undefined || i.target === target));

describe('shareActions', () => {
  it('offers only what applies, and says who will see it', () => {
    expect(shareActions({ program: null })).toEqual([]);

    const personal = { id: 'p', name: 'Mine', assignmentId: null };
    let items = shareActions({ program: personal });
    expect(ids(items)).toEqual(['duplicate', 'copy']);
    expect(find(items, 'copy')).toMatchObject({ enabled: false, reason: expect.stringMatching(/second profile/) });

    items = shareActions({
      program: personal,
      otherProfiles: [{ id: 'q', name: 'Kid' }],
      classes: [cls('a', 'student', 'active'), cls('b', 'student', 'archived', true), cls('c', 'teacher', 'active'), cls('d', 'teacher', 'archived', true)],
    });
    expect(ids(items)).toEqual(['duplicate', 'copy:q', 'send:a', 'publish:c']);
    for (const i of items) {
      expect(i.enabled).toBe(true);
      expect(i.audience).toEqual(expect.any(String));
    }
    expect(find(items, 'send', 'a').audience).toMatch(/Only Teach sees it/);
    expect(find(items, 'publish', 'c').audience).toMatch(/Every student in Class c/);

    const linked = { id: 'l', name: 'Work', assignmentId: 'x', classId: 'a' };
    expect(find(shareActions({ program: linked, classes: [cls('a', 'student', 'active')], assignment: { closedAt: null } }), 'turnin')).toMatchObject({ enabled: true });
    expect(find(shareActions({ program: linked, classes: [cls('a', 'student', 'active')], assignment: { closedAt: 'now' } }), 'turnin')).toMatchObject({ enabled: false, reason: expect.stringMatching(/closed/) });
    expect(find(shareActions({ program: linked, classes: [cls('a', 'student', 'archived', true)] }), 'turnin')).toMatchObject({ enabled: false, reason: expect.stringMatching(/archived/) });
    expect(find(shareActions({ program: linked, classes: [] }), 'turnin')).toMatchObject({ enabled: false, reason: expect.stringMatching(/no longer/) });
    expect(find(shareActions({ program: personal, classes: [cls('a', 'student', 'active')] }), 'turnin')).toBeUndefined();
  });

  // The list grows with every profile and every class, so the popover has to scroll rather than
  // run off the bottom of the screen (itch-19). Vitest runs environment: 'node' — there is no
  // layout engine to measure, so the cap is pinned in the source the way this suite pins other
  // invariants it cannot exercise. Real scrolling is checked in a browser.
  it('caps its own height so a long list stays reachable', () => {
    const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
    const rule = css.split('\n').find((line) => line.startsWith('.share-items {'));
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/max-height:\s*\d/);
    expect(rule).toMatch(/overflow:[^;]*\bauto\b/);
  });

  it('agrees with the server on send, publish and turn in', async () => {
    const reg = async (username) => {
      const b = makeBrowser(base);
      expect((await b('POST', '/api/account/register', { username, password: 'secret1' })).status).toBe(200);
      return b;
    };
    const teacher = await reg('Teach');
    const student = await reg('Sam');
    const open = (await teacher('POST', '/api/classes', { name: 'Open' })).body.class;
    const archived = (await teacher('POST', '/api/classes', { name: 'Archived' })).body.class;
    const left = (await teacher('POST', '/api/classes', { name: 'Left' })).body.class;
    for (const c of [open, archived, left]) await student('POST', '/api/classes/join', { code: c.joinCode });
    const leftM = (await teacher('GET', `/api/classes/${left.id}/roster`)).body.roster[0];
    await teacher('POST', `/api/classes/${left.id}/members/${leftM.id}/remove`, {});

    const sp = (await student('GET', '/api/profiles')).body.profiles[0];
    const tp = (await teacher('GET', '/api/profiles')).body.profiles[0];
    const openA = (await teacher('POST', `/api/classes/${open.id}/assignments`, { lesson: 1, exercise: 1 })).body.assignment;
    const closedA = (await teacher('POST', `/api/classes/${open.id}/assignments`, { lesson: 1, exercise: 2 })).body.assignment;
    const archA = (await teacher('POST', `/api/classes/${archived.id}/assignments`, { lesson: 1, exercise: 3 })).body.assignment;
    const drafts = {};
    for (const a of [openA, closedA, archA]) drafts[a.id] = (await student('POST', `/api/assignments/${a.id}/start`, { profileId: sp.id })).body.program;
    await teacher('POST', `/api/assignments/${closedA.id}/close`);
    await teacher('POST', `/api/classes/${archived.id}/archive`);

    const personal = (await student('POST', `/api/profiles/${sp.id}/programs`, { name: 'Mine' })).body.program;
    const teacherProgram = (await teacher('POST', `/api/profiles/${tp.id}/programs`, { name: 'Demo' })).body.program;
    const studentClasses = (await student('GET', '/api/classes')).body.classes;
    const teacherClasses = (await teacher('GET', '/api/classes')).body.classes;
    expect(studentClasses.map((c) => c.id).sort()).toEqual([open.id, archived.id].sort()); // a removed membership is not listed

    const agree = (item, status, what) => expect({ what, offered: !!(item && item.enabled), allowed: status === 201 }).toEqual({ what, offered: status === 201, allowed: status === 201 });

    // Send a copy: for every class the student ever joined.
    const studentItems = shareActions({ program: personal, classes: studentClasses });
    for (const c of [open, archived, left]) {
      const r = await student('POST', `/api/classes/${c.id}/sent-copies`, { programId: personal.id });
      agree(find(studentItems, 'send', c.id), r.status, `send to ${c.name}`);
    }
    // A teacher is never offered Send, and the server agrees.
    const teacherItems = shareActions({ program: teacherProgram, classes: teacherClasses });
    for (const c of [open, archived]) {
      agree(find(teacherItems, 'send', c.id), (await teacher('POST', `/api/classes/${c.id}/sent-copies`, { programId: teacherProgram.id })).status, `teacher send to ${c.name}`);
      agree(find(teacherItems, 'publish', c.id), (await teacher('POST', `/api/classes/${c.id}/resources`, { programId: teacherProgram.id })).status, `publish to ${c.name}`);
    }
    // A student is never offered Publish, and the server agrees.
    agree(find(studentItems, 'publish', open.id), (await student('POST', `/api/classes/${open.id}/resources`, { programId: personal.id })).status, 'student publish');

    // Turn in: open, closed, archived.
    for (const a of [openA, closedA, archA]) {
      const program = drafts[a.id];
      const assignment = (await student('GET', `/api/assignments/${a.id}`)).body.assignment;
      const item = find(shareActions({ program, classes: studentClasses, assignment }), 'turnin');
      const r = await student('POST', `/api/assignments/${a.id}/submissions`, { programId: program.id });
      agree(item, r.status, `turn in ${a.title}`);
    }
  });
});
