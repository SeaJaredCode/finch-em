// The per-profile floor library (Milestone 2, d-10): the built-in floors from floors.js plus the
// profile's custom floors from /api/profiles/:id/floors (d-8). Custom floor objects are kept by
// identity: the editor mutates them in place and world.floor points at the same object, which is
// what lets the sensors see a freshly placed box straight away.
import { api } from './api.js';
import { BUILTIN_FLOORS } from './floors.js';

// Keep in step with src/floorshape.js FLOOR_DATA_KEYS (Milestone 4 added checkpoints, finishZones,
// goals; Milestone 6 added startB, the second Finch's start mark, null on a one-robot floor).
export const FLOOR_DATA_KEYS = ['description', 'width', 'height', 'background', 'start', 'startB', 'tape', 'walls', 'lights', 'darkAreas', 'slopes', 'checkpoints', 'finishZones', 'goals'];

/** A deep copy of a floor's geometry document (no id, name, builtin or timestamps). */
export function floorData(floor) {
  const out = {};
  for (const k of FLOOR_DATA_KEYS) if (floor[k] !== undefined) out[k] = JSON.parse(JSON.stringify(floor[k]));
  return out;
}

export function createFloorLibrary({ onChange } = {}) {
  let profileId = null;
  let custom = [];

  const notify = () => onChange && onChange();

  /** Load the custom floors of a profile (replaces the previous profile's). */
  async function load(pid) {
    profileId = pid;
    custom = pid ? await api.listFloors(pid) : [];
    notify();
  }

  /** The floor for an id: custom first, then built-in, else the blank floor. */
  function get(id) {
    return custom.find((f) => f.id === id) || BUILTIN_FLOORS.find((f) => f.id === id) || BUILTIN_FLOORS[0];
  }

  function has(id) {
    return custom.some((f) => f.id === id) || BUILTIN_FLOORS.some((f) => f.id === id);
  }

  function uniqueName(base) {
    const names = new Set([...BUILTIN_FLOORS, ...custom].map((f) => f.name));
    let name = base;
    let n = 2;
    while (names.has(name)) name = `${base} ${n++}`;
    return name;
  }

  async function create(name, data) {
    if (!profileId) throw new Error('no profile is open');
    const f = await api.createFloor(profileId, { name, ...data });
    custom.push(f);
    notify();
    return f;
  }

  /** An editable copy of any floor (built-in or custom) in this profile's library. */
  function copy(source, name) {
    return create(name || uniqueName(`${source.name} copy`), floorData(source));
  }

  /** A new empty 120 x 90 cm sheet of white paper. */
  function createBlank(name) {
    const data = floorData(BUILTIN_FLOORS[0]);
    data.description = '';
    return create(name || uniqueName('My floor'), data);
  }

  async function rename(floor, name) {
    const saved = await api.updateFloor(floor.id, { name });
    floor.name = saved.name;
    floor.updatedAt = saved.updatedAt;
    notify();
    return floor;
  }

  async function remove(id) {
    await api.deleteFloor(id);
    custom = custom.filter((f) => f.id !== id);
    notify();
  }

  /** Persist the floor's current geometry (the object is mutated in place by the editor). */
  async function save(floor) {
    const saved = await api.updateFloor(floor.id, { name: floor.name, ...floorData(floor) });
    floor.updatedAt = saved.updatedAt;
    return saved;
  }

  return {
    load,
    get,
    has,
    copy,
    createBlank,
    rename,
    remove,
    save,
    uniqueName,
    get builtin() {
      return BUILTIN_FLOORS;
    },
    get custom() {
      return custom;
    },
    get profileId() {
      return profileId;
    },
  };
}
