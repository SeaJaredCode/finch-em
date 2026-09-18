// The program-and-floor copy shared by hand-off (d-25) and class resources (d-32). Both take the
// caller's scoped store, so every read and write stays inside the caller's own profiles.
import { sanitizeFloor, floorData } from './floorshape.js';

/**
 * A copy of `program` in `targetProfileId`. `floor` is the custom floor the program used — a floor
 * row, or a { name, ...geometry } document from a snapshot — or null. When given it is copied
 * first and the program copy points at the new floor; otherwise the program keeps its built-in
 * floor id. `context` { classId, assignmentId, locked } is Start's alone (d-34): both copies carry
 * the link and the floor copy the lock; hand-off and class copies pass nothing, so a copy of a linked
 * program is an ordinary one. Returns { program, floor }.
 */
export async function copyProgramWithFloor(scope, targetProfileId, { program, floor }, context = {}) {
  const link = context.assignmentId ? { classId: context.classId, assignmentId: context.assignmentId } : {};
  const floorCopy = floor
    ? await scope.createFloor(targetProfileId, { name: floor.name, data: sanitizeFloor(floorData(floor)), ...link, locked: !!(link.assignmentId && context.locked) })
    : null;
  const copy = await scope.createProgram(targetProfileId, {
    name: program.name,
    code: program.code,
    floorId: floorCopy ? floorCopy.id : program.floorId || 'blank',
    exerciseRef: program.exerciseRef || null,
    ...link,
  });
  return { program: copy, floor: floorCopy };
}

/**
 * The d-25 workbook rule: attach the copies to the exercises the source was attached to, only
 * where the target has no attachment yet; `done` is never touched. `attachments` is a list of
 * { lesson, exercise, program: boolean, floor: boolean }. Returns the entries written.
 */
export async function attachToWorkbook(scope, targetProfileId, attachments, { program, floor }) {
  const entries = [];
  if (!attachments.length) return entries;
  const theirs = await scope.listWorkbook(targetProfileId);
  for (const a of attachments) {
    const existing = theirs.find((t) => t.lesson === a.lesson && t.exercise === a.exercise);
    const patch = {};
    if (a.program && program && !(existing && existing.programId)) patch.programId = program.id;
    if (a.floor && floor && !(existing && existing.floorId)) patch.floorId = floor.id;
    if (!Object.keys(patch).length) continue;
    entries.push(await scope.upsertWorkbookEntry(targetProfileId, a.lesson, a.exercise, patch));
  }
  return entries;
}
