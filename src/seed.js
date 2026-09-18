// The lesson template every new program starts from, and the sample program the default profile gets.

export const LESSON_TEMPLATE = `from BirdBrain import Finch
from time import sleep
bird = Finch()
# Write code here!
`;

export const SAMPLE_PROGRAM_NAME = 'Sample: square dance';

export const SAMPLE_PROGRAM = `from BirdBrain import Finch
from time import sleep
bird = Finch()

# Drive a square. Each side gets its own beak colour.
colors = [(100, 0, 0), (0, 100, 0), (0, 0, 100), (100, 100, 0)]
for r, g, b in colors:
    bird.setBeak(r, g, b)
    bird.setTail("all", b, r, g)
    print("Beak is now", r, g, b)
    bird.setMove('F', 20, 50)
    bird.setTurn('R', 90, 50)

bird.print("Hi")
bird.playNote(60, 1)
print("Encoders:", bird.getEncoder('L'), bird.getEncoder('R'))
bird.stopAll()
`;

export const DEFAULT_PROFILE = { name: 'Student', color: '#2f80ed' };

// Runs when a browser gets its first session (POST /api/session, d-29) and has no pre-session
// profile to claim: one default profile with the sample program open, which is what a first
// visit showed before sessions existed. A profile created later through POST /api/profiles
// starts empty (spec AC 22).
export async function seedProfile(store, userId) {
  const profile = await store.createProfile({ ...DEFAULT_PROFILE, userId, prefs: { speed: 1, muted: false } });
  const program = await store.createProgram(profile.id, {
    name: SAMPLE_PROGRAM_NAME,
    code: SAMPLE_PROGRAM,
    floorId: 'blank',
  });
  return store.updateProfile(profile.id, { prefs: { lastProgramId: program.id } });
}
