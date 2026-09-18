// The Share menu (itch-18, d-39). shareActions() is the one place the client decides which sharing
// actions the open program offers; it is DOM-free so tests/share.test.js can check it against the
// server. Its rules read only what GET /classes returns (membership role and state, archivedAt) and
// the assignment's closedAt, mirroring requireOpenStudent and requireTeacher in src/classes.js. Rules
// the client cannot see (a personal floor, a required run) stay on the server and come back as errors.
// renderShareMenu() draws the items; every item says who will see the result.

export const isOpenStudent = (c) => !!c && c.membership.role === 'student' && c.membership.state === 'active' && !c.archivedAt;
export const isOpenTeacher = (c) => !!c && c.membership.role === 'teacher' && !c.archivedAt;

const teacherName = (c) => (c.teacher && c.teacher.username) || 'your teacher';

/**
 * The actions for `program`: [{ id, label, audience, enabled, reason, target }].
 * id is duplicate | copy | turnin | send | publish; target is a profile id (copy) or a class id (send, publish).
 */
export function shareActions({ program, otherProfiles = [], classes = [], assignment = null }) {
  if (!program) return [];
  const items = [{ id: 'duplicate', label: 'Duplicate', audience: 'Only you: a new program in this profile.', enabled: true }];

  if (otherProfiles.length) {
    for (const p of otherProfiles) {
      items.push({
        id: 'copy',
        target: p.id,
        label: `Copy to ${p.name}`,
        audience: `Whoever uses ${p.name} gets it in their Programs and Workbook; your runs stay here.`,
        enabled: true,
      });
    }
  } else {
    items.push({ id: 'copy', label: 'Copy to another profile', audience: 'Another profile on this account gets its own copy.', enabled: false, reason: 'Make a second profile (+ Profile) first.' });
  }

  if (program.assignmentId) {
    const cls = classes.find((c) => c.id === program.classId) || null;
    let reason = null;
    if (!cls) reason = 'You are no longer in this class.';
    else if (!isOpenStudent(cls)) reason = 'This class is archived.';
    else if (assignment && assignment.closedAt) reason = 'This assignment is closed.';
    items.push({
      id: 'turnin',
      target: cls ? cls.id : null,
      label: 'Turn in',
      audience: cls ? `${teacherName(cls)} sees this version as your next attempt.` : 'Your teacher sees this version as your next attempt.',
      enabled: !reason,
      reason,
    });
  }

  for (const c of classes) {
    if (isOpenStudent(c)) {
      items.push({
        id: 'send',
        target: c.id,
        label: `Send a copy to ${teacherName(c)} (${c.name})`,
        audience: `Only ${teacherName(c)} sees it; your classmates never do.`,
        enabled: true,
      });
    }
  }
  for (const c of classes) {
    if (isOpenTeacher(c)) {
      items.push({
        id: 'publish',
        target: c.id,
        label: `Publish to ${c.name}`,
        audience: `Every student in ${c.name} can run and copy this snapshot; your later edits do not change it.`,
        enabled: true,
      });
    }
  }
  return items;
}

/** Draw `items` into `box`; `onPick(item)` runs when an enabled item is chosen. */
export function renderShareMenu(box, items, onPick) {
  box.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'share-empty';
    empty.textContent = 'Open one of your programs to share it.';
    box.appendChild(empty);
    return;
  }
  for (const item of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'share-item';
    b.disabled = !item.enabled;
    b.dataset.action = item.id;
    const label = document.createElement('span');
    label.className = 'share-label';
    label.textContent = item.label;
    const audience = document.createElement('span');
    audience.className = 'share-audience';
    audience.textContent = item.enabled ? item.audience : item.reason || item.audience;
    b.append(label, audience);
    b.addEventListener('click', () => onPick(item));
    box.appendChild(b);
  }
}
