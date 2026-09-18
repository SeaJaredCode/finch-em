// The program list and its actions: new, rename, duplicate, delete, download .py, import .py,
// and autosave of the editor text.
import { api } from './api.js';
import { findSandboxLines } from './editor.js';

const LESSON_TEMPLATE = 'from BirdBrain import Finch\nfrom time import sleep\nbird = Finch()\n# Write code here!\n';

export function createPrograms({ els, editor, otherProfiles, onOpen, onHint, onError, onSaved, onFloorChanged, onTurnIn }) {
  let profileId = null;
  let programs = [];
  let current = null;
  let saveTimer = null;
  let dirty = false;

  function render() {
    els.list.innerHTML = '';
    if (!programs.length) {
      const empty = document.createElement('div');
      empty.className = 'program-empty';
      empty.textContent = 'No programs yet. Press New to start from the lesson template.';
      els.list.appendChild(empty);
    }
    for (const p of programs) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'program-item' + (current && p.id === current.id ? ' active' : '') + (p.assignmentId ? ' assigned' : '');
      item.textContent = p.name;
      item.title =
        `${p.name} — floor: ${p.floorId}${p.exerciseRef ? ` — Workbook exercise ${p.exerciseRef}` : ''}` +
        (p.assignmentId ? ' — your work on a class assignment; your teacher can read it' : '');
      item.addEventListener('click', () => open(p.id));
      els.list.appendChild(item);
    }
    const has = !!current;
    for (const b of [els.btnDuplicate, els.btnDelete, els.btnDownload, els.name]) b.disabled = !has;
    // Turn in (d-35): only for her work on a class assignment.
    if (els.btnTurnIn) els.btnTurnIn.hidden = !(current && current.assignmentId && onTurnIn);
  }

  // ---- "Copy to <profile>" (d-25, offered by the Share menu since d-39): a copy of this program and its floor ----
  async function copyToProfile(targetId) {
    if (!current || !targetId) return;
    const p = current;
    await saveNow();
    const target = (otherProfiles ? otherProfiles() : []).find((x) => x.id === targetId);
    try {
      const result = await api.handoffProgram(p.id, targetId);
      const floorNote = result.floor ? ` and the floor "${result.floor.name}"` : '';
      const n = result.entries ? result.entries.length : 0;
      const wb = n ? ` It is attached to the same Workbook exercise${n === 1 ? '' : 's'} there.` : '';
      onHint && onHint(`Copied "${result.program.name}"${floorNote} to ${target ? target.name : 'the other profile'}.${wb} Your runs stay here.`);
    } catch (err) {
      onError && onError('Could not copy the program: ' + err.message);
    }
  }

  function setStatus(text, cls = '') {
    els.status.textContent = text;
    els.status.className = 'save-status ' + cls;
  }

  async function load(pid, preferredId) {
    profileId = pid;
    current = null;
    programs = await api.listPrograms(pid);
    render();
    const target = programs.find((p) => p.id === preferredId) || programs[0];
    if (target) await open(target.id);
    else {
      editor.setValue('');
      els.name.value = '';
      onOpen && onOpen(null);
      render();
    }
  }

  async function open(id) {
    await saveNow();
    const p = programs.find((x) => x.id === id);
    if (!p) return;
    current = p;
    editor.setValue(p.code);
    els.name.value = p.name;
    dirty = false;
    setStatus('Saved', 'ok');
    render();
    onOpen && onOpen(p);
  }

  function codeChanged(code) {
    if (!current) return;
    current.code = code;
    dirty = true;
    setStatus('Unsaved…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    if (!current || !dirty) return;
    const p = current;
    dirty = false;
    try {
      const saved = await api.updateProgram(p.id, { code: p.code });
      p.updatedAt = saved.updatedAt;
      if (current === p) setStatus('Saved', 'ok');
      onSaved && onSaved(); // a banner from an earlier failed save is stale now
    } catch (err) {
      dirty = true;
      setStatus('Not saved', 'bad');
      onError && onError('Could not save the program: ' + err.message);
    }
  }

  /**
   * The read-only viewer (d-34) takes the editor: save, then let go of the open program so nothing
   * the viewer puts in the editor can reach it. Returns the id it was holding, to reopen afterwards.
   */
  async function detach() {
    await saveNow();
    const was = current ? current.id : null;
    current = null;
    dirty = false;
    els.name.value = '';
    render();
    onOpen && onOpen(null);
    return was;
  }

  async function create(body) {
    if (!profileId) return null;
    try {
      const p = await api.createProgram(profileId, body);
      programs.unshift(p);
      onSaved && onSaved();
      await open(p.id);
      return p;
    } catch (err) {
      onError && onError('Could not create the program: ' + err.message);
      return null;
    }
  }

  function uniqueName(base) {
    let name = base;
    let n = 2;
    while (programs.some((p) => p.name === name)) name = `${base} ${n++}`;
    return name;
  }

  els.btnNew.addEventListener('click', () => create({ name: uniqueName('Untitled program'), code: LESSON_TEMPLATE, floorId: current ? current.floorId : 'blank' }));

  /** A copy in this profile (the Duplicate button and the Share menu). */
  async function duplicate() {
    if (!current) return null;
    await saveNow();
    return create({ name: uniqueName(current.name + ' copy'), code: current.code, floorId: current.floorId });
  }

  els.btnDuplicate.addEventListener('click', () => duplicate());

  els.btnDelete.addEventListener('click', async () => {
    if (!current) return;
    if (!window.confirm(`Delete "${current.name}"? This cannot be undone.`)) return;
    const id = current.id;
    try {
      await api.deleteProgram(id);
    } catch (err) {
      onError && onError('Could not delete the program: ' + err.message);
      return;
    }
    programs = programs.filter((p) => p.id !== id);
    current = null;
    dirty = false;
    if (programs.length) await open(programs[0].id);
    else {
      editor.setValue('');
      els.name.value = '';
      render();
      onOpen && onOpen(null);
    }
  });

  els.btnTurnIn &&
    els.btnTurnIn.addEventListener('click', async () => {
      if (!current || !current.assignmentId || !onTurnIn) return;
      els.btnTurnIn.disabled = true;
      try {
        await saveNow();
        await onTurnIn(current);
      } finally {
        els.btnTurnIn.disabled = false;
      }
    });

  els.name.addEventListener('change', async () => {
    if (!current) return;
    const p = current;
    const name = els.name.value.trim();
    if (!name) {
      els.name.value = p.name;
      return;
    }
    // The new name applies at once, so a run started before the save lands is announced and
    // recorded under it; the server's answer is final, and a failed save puts the old name back.
    const previous = p.name;
    p.name = name;
    render();
    try {
      const saved = await api.updateProgram(p.id, { name });
      p.name = saved.name;
      if (current === p && els.name.value.trim() === name) els.name.value = saved.name;
      render();
      onSaved && onSaved();
    } catch (err) {
      p.name = previous;
      if (current === p) els.name.value = previous;
      render();
      onError && onError('Could not rename the program: ' + err.message);
    }
  });

  els.btnDownload.addEventListener('click', async () => {
    if (!current) return;
    await saveNow();
    const text = editor.getValue();
    // Sandbox-only pen helpers (d-15) would raise AttributeError on the real robot.
    const sandbox = findSandboxLines(text);
    if (
      sandbox.length &&
      !window.confirm(
        `This program uses the sandbox-only pen (penDown / penUp / setPenColor) on line${sandbox.length > 1 ? 's' : ''} ${sandbox.join(', ')}. ` +
          'The real Finch has no pen, so it will stop with an error there. Download anyway?',
      )
    ) {
      return;
    }
    const blob = new Blob([text], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeFileName(current.name) + '.py';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  els.fileImport.addEventListener('change', async () => {
    const file = els.fileImport.files && els.fileImport.files[0];
    els.fileImport.value = '';
    if (!file) return;
    const text = await file.text();
    const base = file.name.replace(/\.py$/i, '') || 'Imported program';
    await create({ name: uniqueName(base), code: text, floorId: current ? current.floorId : 'blank' });
  });

  async function setFloor(floorId) {
    if (!current || current.floorId === floorId) return;
    current.floorId = floorId;
    render();
    try {
      await api.updateProgram(current.id, { floorId });
      onSaved && onSaved();
      onFloorChanged && onFloorChanged(current);
    } catch (err) {
      onError && onError('Could not save the floor choice: ' + err.message);
    }
  }

  /** A custom floor was deleted (the server already reset its programs to 'blank'). */
  function forgetFloor(floorId) {
    let touched = false;
    for (const p of programs) {
      if (p.floorId === floorId) {
        p.floorId = 'blank';
        touched = true;
      }
    }
    if (touched) render();
    return touched;
  }

  window.addEventListener('beforeunload', () => {
    if (dirty && current) {
      navigator.sendBeacon && saveNow();
    }
  });

  return {
    load,
    open,
    detach,
    create, // { name, code?, floorId?, exerciseRef? } -> the new program, opened (used by the Workbook, d-21)
    duplicate,
    copyToProfile,
    codeChanged,
    saveNow,
    setFloor,
    forgetFloor,
    get current() {
      return current;
    },
    get all() {
      return programs;
    },
  };
}

function safeFileName(name) {
  return (name || 'program').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'program';
}
