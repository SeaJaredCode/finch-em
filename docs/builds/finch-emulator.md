# Finch Sandbox

**Status**: building
**Slug**: finch-emulator
**Scope**: large
**Mode**: solo
**App**: https://canary-p-finch-em-83ff0d22-staging.catwrangler.ai (health reports store: pg)
**Spec**: builds/finch-sandbox-spec.md (server docs path; local snapshot Docs/builds/finch-sandbox-spec.md)

## Ask

An emulator for the kids programming tool called Finch. It uses python to control a robot, but only when the robot is around to program. I want my daughter (high school aged) to be able to use it when she's _not_ around the robot.

There are lessons off of https://learn.birdbraintechnologies.com/finch/python/program/ that describe the type of things they will work through, and then an API that's provided documented at: https://learn.birdbraintechnologies.com/finch/python/library/

I want to have a UI that allows her to write her code and run/pause/restart her program and see it move around and interact in a display pane.

Ideally, she'd be able to add "environment" settings to interact with things like the tape maze on the floor, walls, lights, etc. So, they'll need some way to interact/place those things, too.

## Project

Greenfield. Trunk at r7 holds only the CatWrangler provisioner's node-express starter (src/index.js, src/app.js with a hello route, tests/app.test.js smoke test, catwrangler/project.yaml). One decision in the graph (d-1, the starter). No docs on the server. Milestone 1 starts the real app.

## Spec

# Finch Sandbox — Product Spec

*Scope: `large`. Six milestones. Milestone 1 is the complete write-run-watch emulator; each later milestone adds one coherent feature area to a thing that already works.*

## Purpose

Finch Sandbox is a browser app where a high-school student writes the same Python she would write for a real Finch 2.0 robot — `from BirdBrain import Finch`, `bird = Finch()`, `bird.setMove('F',10,50)` — and watches a simulated Finch carry it out on a top-down floor in the next pane. The real robot only works when it is in the room and paired over Bluetooth; the BirdBrain lessons assume it always is. Finch Sandbox lets her keep working through those lessons at the kitchen table or on the bus, then carry the exact same program back to the real robot unchanged. Because the lessons are built around physical setups — black tape tracks on white paper, a box to drive into, a flashlight, a wall to stop in front of, a marker taped to the robot to draw with, a second Finch to dance with — the sandbox supplies those things too: first as ready-made floors, then as floors she lays out herself with goals attached, a workbook that keeps her place in the lesson series, a debugger that lets her step through a loop while the robot waits, and eventually a second robot.

## User stories

1. **As a student**, I can type a Finch program exactly as the lesson shows it, press Run, and see the robot drive, turn, light up, and play notes in the display pane, so I can do the exercises without the robot in the room.
2. **As a student**, I can pause, resume, restart from the top with the robot back on its start mark, or stop, and I can press the robot's buttons, tilt it, shake it, or hold a hand in front of its distance sensor, so the button, sensor, and accelerometer lessons behave the way they do on the real Finch.
3. **As a student**, I can lay out my own floor — tape paths, walls, lights, dark corners, a slope — put a goal on it ("follow the tape to the finish", "stop within 30 cm of the wall"), and the app tells me whether my program met it.
4. **As a student**, I can tape a pen to the robot and see what it draws, keep the drawings, and look back at earlier runs to see where my line-tracker fell off the tape and what the sensors were reading at that moment.
5. **As a student**, I can keep my place in the BirdBrain lesson series — which exercises I've done, which program went with each — and step through a stuck program one line at a time watching my variables, so I can fix it myself.
6. **As a student in Lesson 14**, I can put two Finches on the floor and program them to dance together or have one steer the other.
7. **As a parent**, I can open the app, see a sample program running on a sample floor, see how far she has got in the workbook, and set up a second profile for her sibling without any accounts or passwords.

## The user experience

### The workspace page

One page with a persistent header (profile switcher, workspace sections: **Programs**, **Floors**, **Runs**, **Workbook**) and a three-region working area:

- **Code pane (left).** A code editor with line numbers and Python highlighting; a program name field; a list of saved programs (New, Rename, Duplicate, Delete, Download as `.py`, Import a `.py` file). A new program is pre-filled with the lesson template:
  ```python
  from BirdBrain import Finch
  from time import sleep
  bird = Finch()
  # Write code here!
  ```
  The gutter shows breakpoints and, while stepping, the current line.
- **Arena pane (right, top).** A top-down view of the floor in centimetres with the Finch drawn to scale (about 10 cm wide, 5 cm wheels, beak at the front). The beak LED, four tail LEDs, and 5×5 micro:bit display are drawn on the robot and change live. The floor shows whatever the chosen environment contains: black tape, walls and boxes, light sources with their glow, dark areas, slopes, a start mark, and any goal markers (finish line, checkpoints). A faint trail shows the path driven this run; pen ink (Milestone 3) is drawn on top. A compass rose marks north (up). Zoom and pan for big floors.
- **Console pane (right, bottom).** Everything `print()` writes, in order and timestamped; a prompt box whenever the program calls `input()` (the program waits until she answers, as IDLE does); Python errors in red with the line number, which is also highlighted in the editor; the note the buzzer is playing; goal verdicts.

### Run controls

Above the arena: **Run**, **Pause / Resume**, **Restart**, **Stop**, **Step** (Milestone 5), and a **Speed** control (½×, real-time, 2×, 4×, 8×). Restart puts the robot back on the start mark, clears outputs, encoders, trail, and pen ink, and runs from line 1. Stop ends the program and turns everything off as `stopAll()` would. Pausing freezes the robot, the program, and any `sleep()` or move in progress; resuming continues from that instant. If the program ends with motors still on, the robot keeps rolling until it meets a wall or the floor edge — as the real one does — and the console hints that `stop()`/`stopAll()` was not called.

### Sensor & interaction panel

Beside the arena, a live readout of every sensor, updating while running and while idle: distance (cm), light L/R, line L/R, encoders L/R (rotations), compass heading, orientation, acceleration x/y/z, shaking, buttons, sound, temperature. It is also how she *touches* the robot:

- Buttons **A**, **B**, **Logo** — click to press, click-and-hold to hold (keyboard shortcuts too).
- **Orientation** — Level, Beak up, Beak down, Tilt left, Tilt right, Upside down; acceleration follows. On a slope area of the floor, orientation is taken from the slope and the robot's heading instead.
- **Shake** — shakes the robot for a moment.
- **Hand in front** — a slider that puts an obstacle at a chosen distance from the beak.
- **Sound** and **temperature** — sliders (no physical source on the floor).
- **Drag / rotate the robot** — pick it up and place it anywhere, before or during a run.
- With two robots (Milestone 6) the panel has a tab per robot.

### Floors (environments)

Ready-made floors ship in Milestone 1: *Blank floor*, *Oval tape track*, *Figure-eight track*, *Y-branch track*, *Walled box*, *Flashlight corner*, *Dark tunnel*, *Maze of walls*. Milestone 2 adds the **floor editor** — an edit mode of the arena with a tool palette: draw tape (straight and curved segments, ~2.5 cm wide, black on white; also coloured tape for contrast experiments), place and resize walls and boxes, place light sources (brightness, reach), shade dark areas, mark slope areas (uphill direction), set floor size and background (white paper, wood, carpet — which changes the baseline line-sensor reading), set the start mark (position and heading), undo/redo, snap-to-grid. Floors are named, saved, duplicated, and reused; each program remembers its floor. Milestone 4 lets a floor carry **goals**.

### Runs, drawings, and history (Milestone 3)

Every run is recorded: program text as it was, floor as it was, the trail, the console log, a per-tick sensor trace, elapsed time, distance per wheel, and — if the pen was down — the drawing. The **Runs** section lists them newest first, filterable by program and floor, with a replay (scrub through the run; the sensor readouts and console follow the scrubber) and a sensor timeline chart (line L/R, light L/R, distance over time, with the trail point highlighted as she hovers). A **pen** can be attached in the panel (colour, down/up) and toggled from code with two sandbox-only helpers the app documents clearly as *not* part of the real library (`bird.penDown()`, `bird.penUp()`), so Lesson 1's marker picture, Lesson 12's `drawCircle`, and Lesson 15's fractals produce a picture she can keep in a **Gallery**.

### Goals and the Workbook (Milestone 4)

A floor can carry a goal: *reach the finish zone*, *visit checkpoints in order*, *follow the tape without leaving it for more than N seconds*, *stop within X cm of a wall without touching it*, *finish within T seconds*, *end on the start mark* (the square), *end with the beak pointing north*. The verdict — pass or fail, with the reason and the moment it failed — appears in the console and is stored with the run. The **Workbook** is an in-app checklist of the BirdBrain lesson series (Lessons 1–15, with each lesson's exercises numbered as on the site and a link to the lesson page on BirdBrain's site); she attaches a program and, optionally, a floor to each exercise, marks it done, and sees progress per lesson and overall. The Workbook does not reproduce lesson text; it organizes her work against it. Built-in floors are suggested per exercise where the lesson implies one (Lesson 9's tape track, Lesson 5's wall, Lesson 7's flashlight).

### Debugger (Milestone 5)

**Step** runs one line at a time; the robot performs each line's effect (a `setMove` completes, at the chosen speed) before the next line is highlighted. Breakpoints in the gutter make Run stop at a line. While paused or stepping, a **Variables** panel shows the current values of her variables (numbers, strings, lists, dictionaries expanded), and the call stack when she is inside a function or recursion. A **watch expression** box evaluates something like `bird.getLine('L') - bird.getLine('R')` each tick.

### Two Finches (Milestone 6)

A floor can hold a second robot with its own start mark. `Finch('A')` and `Finch('B')` address them; `Finch()` is A. Each robot has its own panel tab, trail, pen, and readouts; they see each other as obstacles (distance sensor, collisions). Lesson 14's exercises — synchronized dancing, one Finch's tilt steering the other, one's acceleration driving the other's motors — work as written.

### Profiles

A profile is a named workspace (name, avatar colour) holding its own programs, floors, runs, gallery, workbook progress, and preferences. Switching profiles is a click in the header; there are no passwords. One profile exists by default.

## What the emulated Finch does (product-facing behaviour)

This is the surface the student writes against, taken from the BirdBrain Finch 2.0 Python reference and the lessons. The sandbox accepts these calls with the documented names, argument order, units, and ranges, and behaves as the documentation says. Out-of-range values are clamped as the real library clamps them; wrong argument types raise a normal Python error in the console.

**Setup.** `from BirdBrain import Finch`; `bird = Finch()`; `Finch('A')`, `Finch('B')` (from Milestone 6; before that `'B'`/`'C'` raise a clear "no second Finch on this floor" error). `from time import sleep` and `sleep(seconds)` count in simulation time, so they scale with the Speed control. `import random`, `input()`, `print()`, functions, recursion, lists, dictionaries — ordinary Python 3 — work.

**Movement** (to scale in the arena; at speed 100 roughly the real robot's pace):
- `setMove(direction, distance, speed)` — `'F'`/`'B'`, cm, 0–100. Blocks until done.
- `setTurn(direction, angle, speed)` — `'R'`/`'L'`, degrees, 0–100. Turns in place. Blocks until done.
- `setMotors(leftSpeed, rightSpeed)` — −100 to 100 each; returns immediately; wheels keep turning until changed. Unequal speeds arc; opposite speeds spin in place.
- `stop()` — wheels stop.
- The robot cannot pass through walls, boxes, the other robot, or the floor edge: it stops against them (wheels may still be "on"; encoders stop counting).

**Lights and display** (visible on the robot):
- `setBeak(r, g, b)` — 0–100 each; all zero = off.
- `setTail(port, r, g, b)` — port 1–4 or `"all"`.
- `setDisplay(list_of_25)` — 0/1 values, 5×5, row-major.
- `setPoint(row, column, value)` — 1–5, 1–5, 0/1.
- `print(message)` — up to 15 characters scroll across the 5×5 display (`bird.print` goes to the robot; the built-in `print()` goes to the console).
- `stopAll()` — motors, beak, tail, display off.

**Sound.**
- `playNote(note, beats)` — MIDI note 32–135, beats 0–16, one beat = one second; plays audibly through the browser (mutable) and shows in the console. Blocks for its duration.

**Sensors** (read from the floor, the other robot, and the panel):
- `getDistance()` — cm to the nearest wall/box/robot/obstacle straight ahead of the beak, roughly 2–200 cm; beyond range returns a large value as the real sensor does; an object closer than 2 cm reads out-of-range, as the real one cannot see something pressed against it; the "hand in front" slider overrides.
- `getLight('L' | 'R')` — 0–100; higher near a light source, lower in dark areas, a mid baseline on plain floor; the two sensors sit on the robot's two sides, so a lamp to the right reads higher on `'R'`.
- `getLine('L' | 'R')` — 0–100; **low** over black tape, **high** over white floor, intermediate over coloured tape or darker backgrounds; the sensors are on the underside either side of centre, so tape can be under one and not the other.
- `resetEncoders()` / `getEncoder('L' | 'R')` — rotations since reset, positive forward, negative backward, 5 cm wheel (a 10 cm move reads about 0.64).
- `getButton('A' | 'B' | 'Logo')` — True while held in the panel.
- `isShaking()` — True during a panel shake.
- `getOrientation()` — `"Beak up"`, `"Beak down"`, `"Tilt left"`, `"Tilt right"`, `"Level"`, `"Upside down"`, or `"In between"`, from the panel or from a slope area.
- `getAcceleration()` — `[x, y, z]` in m/s², consistent with orientation (about ±10 at rest, larger while shaking).
- `getCompass()` — 0–359°, 0 = north = up, clockwise; follows heading. No calibration.
- `getMagnetometer()` — `[x, y, z]` in µT consistent with heading.
- `getSound()` — 0–100, panel slider.
- `getTemperature()` — °C, panel slider (default 22).

**Sandbox-only additions** (Milestone 3), documented in-app as not existing on the real robot and flagged in the editor with a gentle warning so she removes them before downloading: `penDown()`, `penUp()`, `setPenColor(r, g, b)`.

**Fidelity choices.** Movement distance and turn angle are exact (no wheel slip), which is *more* accurate than the real robot; the app says so. Sensor readings carry a little jitter so threshold-finding exercises (average readings over white and over black) still make sense. `setMove`, `setTurn`, `playNote` block; `setMotors` and all lights return immediately — matching the real library.

## The data it manages

- A **profile** is a named workspace. Everything below belongs to a profile.
- A **program** has a name, its Python code, when it was last edited, the floor it last ran on, and optionally the workbook exercise it belongs to. A profile has many programs.
- A **floor** (environment) has a name, a size in cm, a background surface, a start mark (position and heading) for each robot slot, a collection of placed things — tape segments, walls and boxes, light sources, dark areas, slope areas, checkpoints, finish zones — and optionally a goal with its parameters. Built-in floors can be copied but not edited or deleted. A floor is used by many programs and many runs.
- A **run** belongs to a program and a floor and keeps a snapshot of both as they were at the time, plus the trail, console log, sensor trace, elapsed time, per-wheel distance, goal verdict (with the failure moment if any), and any drawing. A program has many runs; a floor has many runs.
- A **drawing** is the pen ink from a run, kept in the gallery with a title; it can be kept after its run is deleted.
- The **workbook** is the fixed catalogue of 15 lessons with their numbered exercises and links; per profile, each exercise has a done/not-done mark, an optional attached program, and an optional attached floor.
- **Preferences** — last open program, speed, mute, editor font size — per profile.

All of this persists: it survives closing the browser, restarting, and redeploying the app, and is the same on any computer that opens the app. Runs and drawings can be deleted individually or pruned ("keep the last 50 runs per program") so history never becomes clutter.

## Acceptance criteria

**Milestone 1**
1. Opening the app shows a sample program in the editor, the robot on a floor, and pressing Run makes the robot move and the beak change colour; `print()` output appears in the console.
2. Lesson 1's `setMove('F',10,50)`/`setTurn('R',90,50)` code moves the robot visibly 10 cm on the floor's scale and turns a right angle; a four-side square ends on the start mark.
3. Pause mid-`setMove` freezes robot and console; Resume continues; Restart returns to the start mark with lights off and encoders at zero and runs from line 1; Stop turns everything off.
4. On *Oval tape track*, Lesson 9's one-sensor tracker with a sensible threshold follows the track for a full lap; line readouts drop over tape and rise over white.
5. On *Walled box*, `while bird.getDistance() > 30: bird.setMotors(50,50)` stops the robot about 30 cm short of the wall; the distance readout counts down.
6. Holding A exits `while not bird.getButton('A')`; choosing Tilt left makes `getOrientation()` return `"Tilt left"` with matching acceleration; Shake makes `isShaking()` True briefly.
7. After `resetEncoders()` and a 10 cm move, `getEncoder('L')` prints about 0.64.
8. A syntax or runtime error shows red with a line number and highlights the line; `input()` shows a prompt and waits.
9. `bird.print("Hi")` scrolls across the 5×5 display; `setDisplay` with the top-and-bottom-rows list lights exactly those rows; `playNote(60, 1)` is audible for one second.
10. Programs survive closing the tab and restarting the app; Download gives a `.py` whose contents are exactly the editor text; Import of a `.py` creates a program.

**Milestone 2**
11. She draws a Y-shaped tape path, places a box on one branch, saves the floor, and Lesson 9 exercise 6's program follows the path, detects the box, and takes the other branch.
12. On a floor with a slope area, driving the robot uphill makes `getOrientation()` read `"Beak up"` and downhill `"Beak down"` with no panel input.
13. The saved floor is still there after a restart and can be duplicated and edited without affecting the original.

**Milestone 3**
14. With the pen down and Lesson 12's `drawCircle(50, 25)`, a circle appears on the floor and can be saved to the gallery with a title; a Lesson 15 recursive tree draws as expected.
15. The Runs section lists each run; opening one replays it, and scrubbing to the point where the tracker left the tape shows the line-sensor values at that moment on the timeline.

**Milestone 4**
16. A floor with a "stop within 30 cm of the wall without touching" goal reports **Pass** for a correct program and **Fail — touched wall at 4.2 s** for one that drives too far, both in the console and on the run.
17. The Workbook shows Lesson 9 with six exercises; attaching a program to exercise 3 and marking it done raises the lesson's progress, and the link opens BirdBrain's lesson page in a new tab.

**Milestone 5**
18. Pressing Step on a `for i in range(5)` loop advances one line per press, the robot performing each `setMove` before the next line highlights, and the Variables panel shows `i` changing.
19. A breakpoint inside a `while` loop halts Run at that line each iteration; a watch expression updates each halt.

**Milestone 6**
20. On a two-robot floor, Lesson 14's `bird1 = Finch('A')`, `bird2 = Finch('B')`, both `setBeak(0,100,0)` lights both beaks green; a program where A's tilt drives B's motors moves B when A's panel tab is set to Tilt left.
21. Robot A driving toward robot B stops on contact and A's `getDistance()` reported B approaching.

**Throughout**
22. Creating a second profile gives an empty workspace; switching back shows the first profile's programs, floors, runs, and workbook untouched.

## Non-goals

Re-examined at `large` scope. Moved in from the standard spec: **multiple Finches** (now Milestone 6), **step debugging and variable inspection** (Milestone 5), **run history and replays** (Milestone 3), **a per-lesson workbook with progress** (Milestone 4, without reproducing lesson text), **profiles for siblings** (all milestones, no login), **import of `.py` files** (Milestone 1). Still deliberately out:

- **Driving the real robot.** The sandbox never connects to a physical Finch or BlueBird Connector. The bridge back to the real robot is the downloaded `.py` file, which works because the emulated API matches the real one. Doing both in one app would confuse which robot she is looking at and drag in Bluetooth pairing the app cannot control.
- **Hosting or paraphrasing the BirdBrain lesson text and exercise wording.** The Workbook links to each lesson and numbers the exercises; the content stays on BirdBrain's site, which owns it and updates it.
- **Grading in the school sense, teacher dashboards, classrooms, sharing, or accounts with passwords.** Goals give her a pass/fail on her own floors; nothing reports to anyone else. Profiles are a convenience for a household, not an identity system.
- **The "AI with Finch" module, machine learning, cameras, and vision.** Nothing in the documented library depends on them.
- **A general Python IDE.** No file browser, package installation, terminal, or multi-file projects; the debugger exists to step through a Finch program, not to be a Python debugger.
- **Photorealistic physics.** No wheel slip, motor variance, battery droop, pushing objects, or 3-D; movement is exact and the view is top-down. A "realism" noise mode was considered and left out because it would make goal verdicts flaky.
- **Phone or tablet as a primary device.** The app is for a laptop or desktop browser with a keyboard; it should not break on a tablet, but the editor and floor editor are not designed for touch.
- **More than two robots.** The library allows `'C'`; Lesson 14 uses two, and a third adds panel and floor clutter for no lesson.

## Assumptions

- **"Finch" means the Finch Robot 2.0 with the BirdBrain Python library** (`BirdBrain.py`, `Finch` class), as linked in the ask — not Finch 1 and not the Snap!/MakeCode block languages. Rejected reading: a block-based emulator.
- **Programs are ordinary Python 3** using the language features the lessons use. Rejected reading: a restricted mini-language. Anything a lesson writes runs as-is; if a standard-library module she imports is unavailable, the console says so plainly.
- **The pen is a sandbox extra, not an API claim.** The real lessons tape a marker to the robot; there is no library call for it. The sandbox adds `penDown()`/`penUp()`/`setPenColor()` and flags them, rather than making the pen always-on (which would scribble over every run) or panel-only (which cannot express `drawCircle`). Rejected reading: no pen, drawings out of scope.
- **Goals live on floors, not programs**, because a floor is the physical setup the lesson describes and the same program may be tried on several floors. Rejected reading: goals as a property of a workbook exercise.
- **The Workbook is a fixed catalogue**, not something she edits, so it always matches BirdBrain's numbering. Custom to-do items were rejected as scope creep.
- **Compass north is "up" on the floor and needs no calibration**, since calibration is a BlueBird Connector artefact.
- **Speed 100 corresponds roughly to the real robot's pace**, and the Speed control exists because waiting in real time for a 25 cm move is tedious when there is no robot to watch.
- **Buttons, tilt, and shake are physical acts done through the panel**, not constants in code. Rejected reading: code-only stubs.
- **Profiles are unauthenticated.** A household shares one app; a profile keeps siblings' work apart. Rejected reading: real accounts, which the parent did not ask for and which would put a login screen in front of a 15-year-old's homework.

## Roadmap

### Milestone 1 — Write it, run it, watch it
A complete stand-alone practice tool for Lessons 1–13 on ready-made floors.
- Code editor with the lesson template; program list with create/rename/duplicate/delete, import `.py`, download `.py`; programs persist.
- Run / Pause–Resume / Restart / Stop and Speed control.
- Top-down arena with the to-scale Finch, live beak/tail/display, trail, zoom/pan, walls and edges that stop the robot.
- Full emulated `Finch` API as listed, plus `sleep`, `input`, `print`, Python errors with line numbers, audible buzzer with mute.
- Live sensor panel with buttons A/B/Logo, orientation picker, shake, hand-in-front, sound and temperature sliders, drag/rotate the robot.
- Eight built-in floors selectable per program, each with a start mark.
- A default profile and a sample program that runs on first visit.

### Milestone 2 — Build the world
The floor editor and floor library.
- Edit mode on the arena: draw straight and curved tape (black and coloured), place and resize walls and boxes, light sources with brightness and reach, dark areas, slope areas, floor size and background surface, start mark; undo/redo; snap-to-grid.
- Floor library: name, save, duplicate, delete custom floors; copy a built-in as a starting point; each program remembers its floor; floors persist.
- Objects placed while a program is running are seen by the sensors immediately, so "pause when an obstacle appears" can be tested live.

### Milestone 3 — Pens, runs, and replays
Everything a run leaves behind.
- Pen attached in the panel or by `penDown()`/`penUp()`/`setPenColor()`; ink drawn on the floor; drawings saved to a gallery with titles; gallery browse and delete.
- Every run recorded with program and floor snapshots, trail, console, sensor trace, elapsed time, and per-wheel distance.
- Runs section: list, filter by program and floor, replay with scrubber, sensor timeline chart linked to the trail, delete and prune.

### Milestone 4 — Goals and the Workbook
Turning floors into exercises and keeping her place in the series.
- Goal types on floors: finish zone, ordered checkpoints, stay on tape, stop within X cm of a wall untouched, time limit, return to start, end facing a heading; verdicts with the failure moment, shown in the console and stored on the run.
- Built-in floors gain matching goals (the oval track gets "complete a lap on the tape"; the walled box gets "stop within 30 cm").
- Workbook: the 15-lesson catalogue with numbered exercises and links, attach program and floor per exercise, done marks, progress per lesson and overall, suggested floors per exercise, jump from an exercise straight to its program on its floor.

### Milestone 5 — Step through it
The debugger.
- Step: one line per press, the robot completing each line's effect before the next highlights.
- Breakpoints in the gutter; Run halts there; Continue resumes.
- Variables panel with expandable lists and dictionaries and a call stack for functions and recursion; watch expressions evaluated each halt or tick.
- Error messages gain a "what this usually means" hint for the handful of mistakes the lessons provoke (wrong direction letter, missing `sleep` import, forgetting `bird.` on a method).

### Milestone 6 — Two Finches
Lesson 14 and beyond.
- Floors can hold a second robot with its own start mark; `Finch('A')` and `Finch('B')`.
- A panel tab per robot; separate trails, pens, readouts, and goal verdicts per robot where a goal names one.
- Robots see each other as obstacles and cannot overlap; the two-robot floors ship as built-ins with Lesson 14 goals ("dance in sync", "B follows A").
- Profiles get a one-click "hand this floor and program to another profile" copy, so siblings can trade a challenge without sharing a workspace.

## Milestones

Planner order (sequential; each depends on the previous; no concerns raised):

- [x] 1. Write it, run it, watch it — d-5, d-6, d-7 — trunk r46, served build 47 — verified 2026-09-10 — establishes program/floor/profile data, arena, emulated Finch, run controls, sensor panel, built-in floors, persistence
- [x] 2. Build the world — d-8, d-10 — trunk r74, served build 75 — verified 2026-09-10 — floor editor and library on top of M1's floor model
- [x] 3. Pens, runs, and replays — d-13, d-15 — trunk r106, served build 107 — verified 2026-09-10 — recorded runs, trail, sensor trace, pen and gallery; ordered after M2 by user value
- [x] 4. Goals and the Workbook — d-20, d-21 — trunk r162, served build 168 — verified 2026-09-10 — goals live on floors (M2), verdicts stored on runs (M3)
- [x] 5. Step through it — d-23 — trunk r186, served build 192 — verified 2026-09-10; HIGH finding fixed in 5a — debugger; depends only on M1, ordered by value
- [x] 5a. Fix: stale Run request stops the newer run (high); debugger box stale on Pause (medium); rename race (low) — d-23 fix entry — trunk r201, served build 207 — re-verified 2026-09-10
- [x] 6. Two Finches — d-24, d-25 — trunk r242, served build 247 — verified 2026-09-10 — assumes the most: floors with a second start mark (M2), per-robot trails/pens (M3), Lesson 14 goals (M4)
- [x] 7. Final fix pass: sticky error banner, signed odometer, Floors pane reassigning the open program's floor, header timer, debugger box stale at run start, favicon — fix entries on d-7, d-10, d-15, d-21, d-23 — trunk r273, served build 277 — re-verified in the whole-app pass 2026-09-10
- [ ] 8. Fix: long-running function loses its return value after a Skulpt yield (HIGH, final verifier) — fresh builder, fix entry on d-5/d-23

## Contracts

Indexed from builder reports; each is carried by the decision named. Confirmed present in the graph by the orchestrator via search_decisions after milestone 1.

- **d-5** Student Python runs on Skulpt 1.2.0 (jsdelivr CDN) on the main thread. `public/js/runner.js` `createRunner({world,out,onState})` returns run/pause/resume/stop; states idle|running|paused|finished|error. Every blocking Finch call (setMove, setTurn, playNote, sleep, input) is a Skulpt suspension resolved from `World.tick()` through one `'*'` suspension handler. M5 stepping/breakpoints hook that same handler (Sk.debugging), not a second execution path.
- **d-5** `public/js/birdbrain.js` `installBirdBrain(bridge)` registers Skulpt modules BirdBrain and time; bridge = `{ world, getRobot(name), note(msg) }`. `Finch('B')` raises ValueError until M6 extends getRobot. M3 pen helpers go in the same finchClass method table. Bad direction letters / wrong arg types raise ValueError/TypeError with a line number.
- **d-5/d-7** `window.finchSandbox = { world, runner, editor, programs, profiles, console, run, advance(seconds) }` is the browser-automation hook; `advance()` steps the world synchronously (the hidden browser pane throttles timers). Reuse for later milestones' checks.
- **d-6** Postgres tables `profiles(id uuid, name, color, prefs jsonb, created_at)` and `programs(id uuid, profile_id FK cascade, name, code, floor_id text, exercise_ref text, created_at, updated_at)` declared in `schema/profiles.sql`, `schema/programs.sql`. `floor_id` is a text key: built-in ids like 'oval'; M2 custom floors use their row id.
- **d-6** JSON routes in `src/routes/api.js`: GET/POST /api/profiles (GET seeds default 'Student' profile + sample program when empty), GET/PATCH /api/profiles/:id (prefs merged), GET/POST /api/profiles/:id/programs, GET/PUT/DELETE /api/programs/:id, GET /api/template. Rows camelCase with ISO timestamps; errors `{error}` 400/404/500.
- **d-6** Store interface `src/store/index.js` `getStore()` (pg when DATABASE_URL set, memory otherwise; `resetStoreForTests` for vitest). New tables = sibling `schema/<table>.sql` + methods on both `src/store/pg.js` and `src/store/memory.js`. `/health` reports `{status, store:'pg'|'memory', db}` and must read 'pg' on staging.
- **d-6** prefs keys: lastProgramId, speed (0.5|1|2|4|8), muted, fontSize, visited. Browser remembers chosen profile in localStorage `finch-sandbox.profileId`.
- **d-7** Client is unbundled ES modules under `public/js` (main, api, editor [CodeMirror 5 from cdnjs, 'breakpoints' gutter already declared], arena, panel, console, programs, profiles, audio, floors, sim/world, sim/robot, sim/geometry, sim/font5x5); no build step.
- **d-7** World units cm, x right, y up (north), heading degrees clockwise from north; robot pose = midpoint of 10 cm wheel track, 5 cm wheels (WHEEL_CIRC 15.708, 10 cm = 0.637 rotations), beak tip 10.5 cm ahead, collision circle 6.5 cm, maxSpeed 25 cm/s at speed 100; getDistance reports 300 when <2 or >200 cm; floor edge blocks the robot but is invisible to the distance sensor.
- **d-7** Floor object `{id,name,description,width,height,background,start:{x,y,heading},tape:[{points,width,color,reading?}],walls:[{x,y,w,h}],lights:[{x,y,brightness,reach}],darkAreas:[{x,y,w,h}],slopes:[{x,y,w,h,uphill}],builtin}`; built-in ids blank, oval, figure-eight, y-branch, walled-box, flashlight-corner, dark-tunnel, maze. M2 custom floors and M4 goals extend this shape.
- **d-7** World exposes tick(dt), wait()/rejectWaiters(), sleep/startMove/startTurn/playNote promises, sensors(robot) snapshot, input {buttons, orientation, shakeUntil, hand, sound, temperature}, trail, onBump; main.js ticks at 60 Hz setInterval scaled by Speed and frozen while paused, draws on requestAnimationFrame.

Builder notes worth carrying: wrong direction letters raise ValueError (real library prints and ignores) so M5 hints can build on a visible error; a setMove that hits a wall ends the call with a console 'Bump' hint; Skulpt/CodeMirror load from CDNs at runtime with a banner if blocked.

### Milestone 2 (d-8 server/persistence, d-10 client editor) — confirmed in graph via search_decisions

- **d-8** Table `floors` (`schema/floors.sql`): id uuid, profile_id FK profiles ON DELETE CASCADE, name text, data jsonb (geometry document), created_at, updated_at. Built-in floors are code (`public/js/floors.js`), never rows.
- **d-8** `programs.floor_id` names a built-in id or a `floors.id` uuid; DELETE /api/floors/:id resets every program that used it to 'blank' (store.deleteFloor), mirrored client-side by `programs.forgetFloor(id)`.
- **d-8** Routes: GET/POST /api/profiles/:id/floors, GET/PUT/DELETE /api/floors/:id; PUT merges present geometry keys over stored ones, name alone renames; 400 `{error}` names the bad field; unknown/non-uuid ids answer 404.
- **d-8** Floor row shape = the d-7 floor object flattened with id, profileId, name, builtin:false, createdAt, updatedAt — same keys as a built-in floor. New optional key `walls[i].kind === 'box'` (rendering only; sensors treat it as a wall).
- **d-8** `src/floorshape.js` is the single validator (FLOOR_DATA_KEYS, FLOOR_LIMITS, sanitizeFloor, hasFloorFields, floorData); M4 goals/checkpoints/finishZones extend FLOOR_DATA_KEYS and sanitizeFloor rather than bypassing it.
- **d-8** Store interface gains listFloors/getFloor/createFloor(profileId,{name,data})/updateFloor(id,{name?,data?})/deleteFloor(id) on pg and memory stores; `public/js/api.js` gains the matching client calls.
- **d-10** `public/js/floorlib.js` createFloorLibrary: per-profile library (load(profileId), get(id) falls back custom → built-in → blank, copy, createBlank, rename, remove, save, uniqueName); custom floor objects are kept by identity and `world.floor` points at the same object; `floorData(floor)` is the deep-copy helper M3 run snapshots should use.
- **d-10** `public/js/flooreditor.js` createFloorEditor: edit mode over the live world.floor with TOOLS select/tape/curve/wall/box/light/dark/slope/start, 5 cm snap (15° headings), JSON-snapshot undo/redo (max 100), 600 ms debounced autosave; `arena.setEditor(editor)` delegates pointer events and draws `editor.drawOverlay` inside the cm transform; built-ins are read-only. New on-canvas tools (M4) go into TOOLS + hitTest/handlesOf/buildProps/drawOverlay.
- **d-10** Header sections: buttons carry data-section='programs'|'floors'; `main.js showSection` toggles hidden on #code-pane/#floors-pane; Runs/Workbook stay disabled until their milestone adds a pane and a data-section. `[hidden]{display:none !important}` is global CSS.
- **d-10** Run-bar #floor-select has optgroups 'Built-in' and 'My floors'; `main.js selectFloor(id)` stops the runner, loads the floor and remembers it on the open program; the floor library loads per profile before programs.load and on every profile switch.
- **d-10** `window.finchSandbox` gains floors (library), floorEditor, arena, selectFloor(id), showSection(name).

Builder notes: the editor mutates world.floor in place, so a wall dropped on the robot blocks it until moved (intentional); d-9 was consumed by a rejected registration and does not exist.

### Milestone 3 (d-13 persistence, d-15 client) — confirmed in graph via search_decisions

- **d-13** Table `runs` (profile_id and program_id FKs ON DELETE CASCADE — deleting a program deletes its runs; memory store mirrors) with data jsonb `{ code, speed, floor (sanitizeFloor'd + id/name/builtin), trail, trace: {fields:[t,x,y,heading,lineL,lineR,lightL,lightR,distance,encoderL,encoderR], samples}, console:[[t,kind,text]], ink:[{color,width,points:[[x,y,t]]}], error }`; `src/runshape.js` truncates over-long lists (trail 6000, samples 5000, ink 30000 pts, console newest 1000). M4 adds the goal verdict as a new data key through sanitizeRun.
- **d-13** Table `drawings` — run_id is a nullable uuid without an FK (a drawing outlives its run); data `{ width, height, background, strokes }`.
- **d-13** Routes: GET /api/profiles/:id/runs?programId&floorId (newest first, no data), POST /api/profiles/:id/runs (programId must belong to the profile), POST /api/profiles/:id/runs/prune {keep=50} → {deleted} (per program), GET/DELETE /api/runs/:id (GET carries data); GET/POST /api/profiles/:id/drawings, GET/DELETE /api/drawings/:id; store methods listRuns/getRun/createRun/deleteRun/pruneRuns and listDrawings/getDrawing/createDrawing/deleteDrawing on both stores; matching client wrappers in `public/js/api.js`.
- **d-15** `robot.pen {down,color,width}` lives on the Robot and survives Restart; `robot.odometer` counts cm per wheel per run independent of resetEncoders; `world.ink` strokes `[{color,width,robot,points:[[x,y,t]]}]` via world.setPen/inkPoint/clearInk; resetRun() and setFloor() clear ink with the trail.
- **d-15** penDown/penUp/setPenColor(r,g,b 0-100) in the finchClass method table; `editor.js` exports findSandboxLines/SANDBOX_CALL_RE, adds the 'sandbox-line' class and onSandboxCalls; main.js shows #sandbox-warning; Download .py confirms first.
- **d-15** `arena.setScene(scene)` / `arena.scene` — a scene `{floor (start may be null), robots:[Robot], trail, ink, time, input:{hand}, marker}` is drawn instead of the world (robot not draggable, editor gets no events); ink drawn after the trail and before the robot, plus pen dot and hover marker ring.
- **d-15** `panel.setOverride({x,y,heading,lineL,lineR,lightL,lightR,distance,encoderL,encoderR}|null)` makes readouts follow a replay; console keeps a log (`consoleUi.entries` → [[t,kind,text]]), `showEntries(entries, upTo)` / `restore()` for replay.
- **d-15** `recorder.js createRecorder({world, consoleUi})` → start({profileId, program, code, speed}) right after world.resetRun, `sample()` after EVERY world.tick (main loop and finchSandbox.advance — **M5's debugger must call it after any tick it performs**), finish(status, error) → {profileId, body}; 20 Hz, rate halves past 3000 samples, trail ≤4000, ink ≤20000, console newest 500; main.js records every run (finishRun → saveRun).
- **d-15** `runs.js createRuns({root:#runs-pane, arena, panel, consoleUi, onOpen, onHint, onError})` → load/refresh/add/openRun/openDrawing/close/setTime/play/pause/deleteRun/deleteDrawing/prune/saveDrawing({..., title?})/setActive, runs/drawings/open/lastRunId; header Runs button has data-section="runs"; showSection('runs') refreshes and leaving it closes any replay; startRun closes a replay first; runsUi.load runs before programs.load on boot and profile switch; `window.finchSandbox` gains runs and recorder.

Builder notes: the sensor trace records pose/line/light/distance/encoders only (no LED or display state) — M4/M6 needing more must extend TRACE_FIELDS and sanitizeRun; replay plays at 1× wall-clock regardless of the run's Speed (the scrubber is the main tool); pruning is a user action only; over-long run documents are truncated server-side rather than rejected. Evidence left in profile Student: floor "M3 pen floor", programs "M3 circle", "M3 tree", "M3 off the tape", their runs, drawing "M3 circle drawing".

### Milestone 4 (d-20 goals/verdicts, d-21 workbook) — confirmed in graph via search_decisions

- **d-20** Floor document keys `checkpoints [{x,y,r}]` (array order = visiting order), `finishZones [{x,y,w,h}]`, `goals [{type,...params}]` (max 10) go through `src/floorshape.js` FLOOR_DATA_KEYS/sanitizeFloor and `public/js/floorlib.js`; goal types and clamps in floorshape GOAL_TYPES (finish, checkpoints, stayOnTape{maxOff}, lap{maxOff}, stopNearWall{distance}, timeLimit{seconds}, returnToStart{tolerance}, endFacing{heading,tolerance}); pre-M4 floors lack the keys and every consumer defaults them to [].
- **d-20** `public/js/goals.js createGoalTracker(world)` → {tick(), finish(status) → verdict|null, failed}; main.js creates one per run after world.resetRun and calls tick() after EVERY world.tick beside recorder.sample() (clock and finchSandbox.advance) — **M5's debugger must call goalTracker.tick() after any tick it performs itself**; `window.finchSandbox.goalTracker` exposes it.
- **d-20** Verdict shape `{pass, text, time, goals:[{type,label,pass,reason,time}]}`; text 'Pass — …' or 'Fail — <first reason with its moment>'; stopNearWall measures from the beak tip along the heading (like getDistance) with +3 cm grace; a user-stopped run gets a verdict only if a goal already failed; no goals → null.
- **d-20** Console kind 'verdict-pass'|'verdict-fail' via `consoleUi.verdict(v)`, logged before recorder.finish so replays show it; `recorder.finish(status, error, verdict)` stores data.verdict; runs table gains verdict text / passed boolean derived by sanitizeRun, present in the list summary and on run rows.
- **d-20** Arena draws finishZones (chequered FINISH) and numbered checkpoints for live floors and replay scenes; floor editor TOOLS gain checkpoint (radius handle, ▲▼ order) and finish (rect); first marker auto-adds its goal; goal list is `public/js/goalprops.js renderGoalList(#floor-goals, floor, {editable, mutate})` using the editor's begin/commit so undo and autosave apply.
- **d-20** Built-in goals: oval → lap 3 s; walled-box → stopNearWall 30; y-branch → finish + stayOnTape with a finish zone; flashlight-corner and maze → finish zones.
- **d-21** `public/js/lessons.js` is the fixed catalogue (LESSONS 15 entries {n,title,name,url,exercises,floor?,floors?}, TOTAL_EXERCISES 102, lessonByNumber, suggestedFloor, exerciseRef '9.3', parseExerciseRef) imported by BOTH the client and `src/routes/api.js`; no lesson text anywhere.
- **d-21** Table `workbook_entries` (profile_id FK cascade, lesson, exercise, done, program_id FK SET NULL, floor_id text cleared by deleteFloor, UNIQUE(profile, lesson, exercise)); store listWorkbook / upsertWorkbookEntry(profileId, lesson, exercise, {done?, programId?, floorId?}) on pg and memory; row {id, profileId, lesson, exercise, done, programId, floorId, updatedAt}.
- **d-21** Routes GET /api/profiles/:id/workbook → {entries}; PUT /api/profiles/:id/workbook/:lesson/:exercise {done?, programId?|null, floorId?|null} → {entry} (404 outside the catalogue, 400 for another profile's program); attaching a program sets programs.exercise_ref = 'L.E'; client api.listWorkbook / api.updateWorkbookEntry.
- **d-21** Workbook pane `public/js/workbook.js createWorkbook({root, programs, library, onOpenExercise, onHint, onError})` → {load, render, setActive, setEntry, progress, entries}; header data-section='workbook'; main.js loads it after programs.load per profile; Open ▶ opens the program and selectFloor(entry.floorId); programs.create is now exported; `window.finchSandbox.workbook`.
- **d-21** **M6's hand-to-another-profile copy must move workbook_entries rows with programs/floors.**

Builder notes: flooreditor.js is now 1005 lines, over the 1000-line auto-split trigger — CatWrangler may split it out of band; re-read before editing. The 'primitives' declaration on d-20/d-21 could not be saved (roles are described in the decision bodies). Two 404s at page load predate M4 (likely favicon). Evidence left: profile "M4 verifier" (programs "M4 tracker", "M4 wall crash", "M4 wall pass", floor "M4 goal course", two runs with verdicts, workbook entry 9.3). A verification slip briefly created two programs in Student; the builder deleted them and confirmed Student's own data was untouched.

### Milestone 5 (d-23 debugger) — confirmed in graph via search_decisions; full contracts in d-23's body

- **d-23** `public/js/runner.js createRunner({ world, out, onState, onHalt })` → run(code, { step? }), pause(), resume() (= Continue while halted), step() → boolean (false = nothing running; caller starts run(code, {step:true}) which parks before line 1), stop(), setBreakpoints(lines[]), evalWatch(expr) → {ok, text}|null, globalsFrame(), describeError(), state, paused (true at halts too), busy, halt, stepping; exports StopSignal, nextMacrotask, MAIN_FILE ('<stdin>.py'), findDefs, enclosingDef.
- **d-23** Every run calls Sk.configure with debugging:true and breakpoints:shouldBreak (answers only for '<stdin>.py', only while stepping or on a breakpoint line); the 'Sk.debug' suspension is parked by the same '*' handler with the clock frozen — the debugger performs no world ticks of its own, so recorder.sample()/goalTracker.tick() ordering (d-15/d-20) is unchanged.
- **d-23** onHalt(halt, mode) — halt = { line, reason:'step'|'breakpoint', frames, release(mode), reject(err) } when parked; onHalt(null, 'step'|'continue'|'stop') when it moves on. A frame = { line, isModule, name, vars:[{name, key (Skulpt-mangled), value (Skulpt object)}], globals }; frames outermost first.
- **d-23** **Overlap fix:** run() is sequenced — a run() superseded by another while it awaits stop() returns {status:'stopped'} without starting; stop() only resets state when no newer run has taken over; main.js startRun carries a runToken across its awaits. Root cause of the M3 early-finish: two Skulpt programs sharing the robot; the stale-waiter hypothesis did not hold.
- **d-23** `editor.js createEditor(textarea, { onChange, onSandboxCalls, onBreakpointsChange(lines) })` adds setCurrentLine(line|null) ('current-line' class), toggleBreakpoint(line), getBreakpoints() (1-based; follow edits via CodeMirror line handles), clearBreakpoints(), currentLine; gutterClick toggles; div.breakpoint-marker in the 'breakpoints' gutter; setValue clears breakpoints and the current line.
- **d-23** `debugpanel.js createDebugPanel(#debugger, { evalWatch })` → showHalt, showRunning, showFinal, clear, refreshWatch(force) (150 ms throttle), watchExpression; DOM ids #debug-status, #watch-expr, #watch-value, #debug-vars, #debug-stack; a Finch instance renders as 'the Finch (robot A)' from value.$robot.name — M6's two robots already read A/B.
- **d-23** `hints.js` (pure ESM, vitest-tested): errorHint({type, message, line}, code) → string|null; main.js prints 'What this usually means: …' as a console hint line right after the error so it is recorded with the run and shows in replays.
- **d-23** Run bar gains #btn-step; #btn-pause reads 'Pause' / 'Resume' / '▶ Continue' (halted); #run-state 'Paused at line N'; breakpoint halts log 'Breakpoint: paused before line N.' (Step halts do not); `window.finchSandbox` gains step() and debugPanel.

Builder notes: Skulpt 1.2.0 has no eval, so the watch is a compiled exec-mode module on a copy of the globals plus the parked frame's locals and cannot block; Sk.breakpoints is called before every statement in every run (d-23 records switching to on-demand debug compilation if a tight loop at 8× stutters); Restart while parked records a 0 s 'stopped' run. Evidence: profile "Builder M5".

### Milestone 6 (d-24 two robots, d-25 hand-off) — confirmed in graph via search_decisions

- **d-24** Floor document: optional `startB: {x, y, heading} | null` beside `start` (FLOOR_DATA_KEYS on client and server; sanitizeFloor turns absent into null). A floor is two-robot iff startB is an object. Built-ins carry startB null except the two-robot built-ins `duet` and `follow-leader`.
- **d-24** World: `world.robots` is [A] or [A, B]; `world.syncRobots()` (idempotent) adds/drops B from floor.startB — called by setFloor/resetRun and by main.js after every floor-editor mutation via the editor's `onFloorEdited` callback. `world.robot('B')` is null on a one-robot floor; `world.startOf(robot)`; `world.twoRobots`.
- **d-24** Robot owns `input` (buttons, orientation, shakeUntil, hand, sound, temperature — newInput() in robot.js), `trail` and `pen`; `world.input` / `world.trail` are read-only aliases of robot A. World sensor methods take the robot. Robots collide as 2×bodyRadius circles (hard stop, no pushing); distance() ray-casts the other robot's body (geometry.rayCircle).
- **d-24** Bridge: Finch()/Finch('A') → A; Finch('B') → B, or ValueError 'No second Finch on this floor…'; any other name → ValueError '…at most two Finches'. getButton/isShaking read the robot's own input.
- **d-24** Goals: any goal may carry `robot: 'A'|'B'`; the tracker judges that robot against its own start mark. Two-robot types `inSync {tolerance, maxOff}` and `follow {distance, tolerance}` (server GOAL_TYPES clamp). goalLabel(g, twoRobots) prefixes 'Finch A:/B:'; verdict goal results carry `robot` ('AB' for two-robot goals, dropped by runshape).
- **d-24** Trace: on a two-robot run trace.fields = TRACE_FIELDS.concat(TRACE_FIELDS_B) (21 columns; runshape sampleWidth 24). runs.js resolves columns by name from trace.fields. Ink strokes carry `robot`. Replay scenes hold robots [A] or [A, B] from the snapshot's startB, each with its own trail. The Runs timeline chart still plots Finch A's series.
- **d-24** Panel: `panel.setOverride({A: readouts, B?: readouts})` (flat object = A); `panel.selectRobot(name)`, `panel.robotName`, `panel.robot`; tab strip `[data-c=robot-tabs]` shows only with two robots; `onPlaceAtStart(robot)`. `window.finchSandbox.panel`.
- **d-24** Floor editor: tool id `startB`, selection {kind:'startB'}, Remove selected sets startB null (undo restores); `onFloorEdited(floor)` fires after every mutation.
- **d-25** POST /api/programs/:id/handoff {profileId} → 201 {program, floor|null, entries}: copies the program (name, code, exerciseRef) into the target, copies a custom floor as a new floors row (built-in ids unchanged) and points the copy at it, upserts the target's workbook_entries for exercises the source attached this program/floor to (done never copied; existing target attachments left alone). 400 same profile / bad id, 404 unknown. Runs and drawings never copied. Not transactional (composed store calls). Client: api.handoffProgram(id, profileId); Programs pane `<select id="handoff-select">` fed by profiles.all through createPrograms({otherProfiles, onHint}).

Builder notes: startB (not a starts[] array) keeps every single-robot document unchanged; anything assigning world.input/world.trail would now hit a getter (nothing on trunk did); flooreditor.js is 1025 lines and a split was queued at checkout — re-read before editing. Evidence: profiles "Builder M6", "Builder M6 b".

### Final fix pass (fix entries on d-7, d-10, d-15, d-21, d-23 at r273) — confirmed via search_decisions recent_fixes

- **d-10** Floors-pane actions are previews: flooreditor.js onSelectFloor(id) → main.js previewFloor(id) (stops the runner, loads the floor, assigns nothing). A program's floor is assigned only by the run-bar #floor-select, the Workbook Open ▶ jump, a hand-off, or the Floors pane's #floor-use button ("Use for "<program>""; createFloorEditor options onUseFloor(id) → selectFloor, openProgram() → programs.current; programs.onFloorChanged → floorEditor.refreshList()).
- **d-10/d-7** main.js showSection tracks currentSection; leaving 'floors' restores the open program's own floor unless runner.busy; startRun loads the program's own floor first whenever the Floors pane is not active; a Run while the Floors pane is open uses the floor being edited (recorded on it, not assigned). `window.finchSandbox.previewFloor(id)`.
- **d-7** main.js banner(message, kind, { sticky }): module onError banners are clearable; boot-level ones (CDN, workspace/floor-library load) pass sticky:true. Every persisting module takes an onSaved callback (createPrograms, createFloorEditor, createWorkbook, createRuns) and calls it after a successful save; main.js savedOk() clears a clearable banner.
- **d-15** robot.odometer.{left,right} is absolute distance travelled per wheel this run (recorder wheelLeft/wheelRight); robot.wheelDist / robot.encoder() remain signed.
- **d-23** debugpanel.showRunning(line, fresh): fresh=true only at run start (empties frames); Resume and Step release call it without fresh. main.js keeps timeShown (null = live clock), set at run end and reset in startRun and loadFloor.
- **d-7** index.html carries an inline SVG favicon.

### Milestone 5a fix (d-23 fix entry, r201) — confirmed via search_decisions recent_fixes

- **d-23** main.js startRun checks `token !== runToken` after EVERY await and before every side effect; a superseded request never calls runner.stop() and never touches the world, console, recorder or debugger box.
- **d-23** Runs are serialized through main.js `runInFlight`: a new request awaits the previous run's finishRun after runner.stop(), so a stopped run's 'Stopped.' line, recording and debugger box land in its own console before the next run clears the console and starts the recorder.
- **d-23** finishRun's 'stopped' and 'error' branches both call parkRobot(): motors {0,0} and pending = null unless runner.busy.
- **d-23** `runner.currentFrames()` → frames[]: at a halt the parked frames; while running or user-paused the frames of the suspension the program is waiting at; otherwise globalsFrame(). `debugPanel.showPaused(frames)` renders a user Pause with status 'Paused during line N — these are the variables right now…'; main.js onRunnerState routes 'paused' without a halt to it.
- **d-23** programs.js rename sets programs.current.name as typed before the PUT; a failed PUT restores the previous name.

## Verification

Orchestrator (first-hand, 2026-09-10): trunk r46 lists all 29 builder files; fresh curl of staging `/` serves the new index.html with Skulpt 1.2.0 and CodeMirror 5 tags and `js/main.js`; `/health` = `{status:ok, store:pg, db:ok}`; `query_db data_plane:staging` shows 1 profile and 1 program ("Sample: square dance") in the deployed Postgres; d-5/d-6/d-7 present in the graph with the contracts above.

Verifier, milestone 1 (first-hand in the browser pane, 2026-09-10): page renders with no console errors; criteria 1–10 and 22 all **pass** — sample runs and returns to start with beak colours and prints; Lesson 1 square is exact (10.0 cm sides, 90° turns, ends on start mark); pause freezes mid-setMove, resume continues, restart resets pose/lights/encoders and reruns from line 1, stop turns everything off; oval one-sensor tracker completed a −360° lap in 79 s with line readings 11/92 split over tape/white; walled box loop stops at 30–31 cm with the readout counting down; A button, Tilt left, Shake all observed through the real panel controls; encoders 0.637 after 10 cm; SyntaxError and ZeroDivisionError shown red with line numbers and the editor line highlighted; input() blocks with a prompt and continues with the typed value; setDisplay lights exactly rows 1 and 5, playNote holds the buzzer 1.0 s, bird.print scrolls; Download bytes identical to editor text; Import creates a program; second profile is empty and switching back restores the first. **Persistence pass**: programs and a second profile survived `cold_restart` dpj-mtuvtcms-pykkk047. Empty state and failed-request state both render.

Relayed, not confirmed: audibility of the buzzer (state and WebAudio wiring only); the first-visit auto-run (seeded profile already had visited=true).

Verifier, milestone 2 (first-hand in the browser pane with real pointer drags on the arena canvas, 2026-09-10): page renders with no console errors; Floors section opens the 9-tool editor. Criteria 11, 12, 13 all **pass** — a Y-shaped tape path with a box on one branch was drawn by mouse, saved, and an exercise-6-style line follower followed the stem, saw the box at 14 cm, and took the other branch; a slope area gave "Beak up" driving east (uphill 90), "Beak down" west, "Tilt right" across, "Level" off the slope, with the panel untouched; the floor survived `cold_restart` dpj-mtuyhbqc-l0fw1k7n, and a copy took a new wall without touching the original. Every roadmap item confirmed: straight and curved tape, red tape reads 47 vs 90 white, walls and boxes placed and resized by handle, lamp with brightness and reach (L/R 29/37 with the lamp to the right), dark area drops light to 5/4, floor width and wood surface (line baseline 61/62 vs 90), start mark position and heading by drag, undo/redo, snap on/off, built-ins locked and copyable, rename/copy/delete, delete falls a program back to blank, program remembers its floor across reload and restart, a wall dropped mid-run read 10 cm the same tick, second profile has its own empty library, empty and failed-save states render. Evidence left in profile Student: floor "Verifier Y-branch" and program "Verifier ex6".

Verifier, milestone 3 (first-hand in the browser pane, real button clicks, scrubber drags and chart hovers, 2026-09-10): renders with no console errors; empty states for programs, runs and drawings render in a fresh profile. Criteria 14 and 15 **pass** — a `drawCircle(50, 25)`-style setMotors arc drew a closed 15 cm-radius blue circle (341 ink points) saved to the gallery with a title from the panel's Save drawing button; a recursive `tree(40, 3)` drew a green branching tree (873 points); a straight drive off the oval was listed newest-first in Runs, replayed, and dragging the scrubber showed line L/R 10/10 on tape at 0.31 s and 11/89 at 0.38 s as the right sensor left it, with the console following and the chart hover marking the trail point. Roadmap confirmed: panel pen down/up/colour/clear, editor's yellow sandbox-only warning tinting lines 11/12/14, Download confirms with sandbox calls present, Restart clears ink, filters populated, legend shows line L/R, light L/R, distance, elapsed and per-wheel distance in run meta, delete run, prune, gallery open/delete, a drawing survives deleting its run, deleting a program cascades its runs, failed save shows a banner without blanking. **Persistence pass**: 8 programs, 2 custom floors, 21 runs and 2 drawings survived `cold_restart` dpj-mtv16ogr-msny40d8; Sibling stayed empty. Evidence left: program "Verifier M3 circle", its run, drawing "Verifier M3 circle drawing".

Verifier, milestone 4 (first-hand in the browser pane in its own profile "Verifier M4", real buttons, checkboxes, canvas tools and inputs, 2026-09-10): renders with no app-resource errors (only favicon 404s). Criteria 16 and 17 **pass** — on the built-in Walled box the correct loop gave "Pass — stopped 30.4 cm from the wall" and `setMove('F',200,50)` gave "Fail — touched wall at 7.2 s" in the console, the Runs list and the replay; a copy with the goal removed, undone, and re-added by hand behaved the same; the Workbook shows Lesson 9 with six exercises and the correct BirdBrain link (target _blank), attaching a program to 9.3 and ticking it moved the lesson to 1/6 and overall to 1 of 102 and set the program's exercise ref. Every goal type provoked to Pass and Fail with moments: checkpoints in order / out of order, finish zone, time limit (edited to 2 s), return to start, end facing north, lap on the oval (37.2 s pass; straight drive "left the tape for more than 3 s at 4.6 s"), stay on tape on the Y-branch. Arena draws numbered checkpoints and the chequered FINISH zone. Built-in goals present on oval, walled-box, y-branch, flashlight-corner, maze. Goal list edits undo and autosave. All 15 lessons listed with links, exercise counts summing to 102, suggested floors for L5/L7/L9 and others, Open ▶ jumps to the program on its floor. **Persistence pass**: profile, 9 programs, 3 floors with goals, 17 runs with verdicts and the workbook entry survived `cold_restart` dpj-mtv4d08n-7ifmd66x; a second new profile is empty. Failed saves for workbook and floor show a banner without blanking.

Verifier, milestone 5 (first-hand in the browser pane in its own profile "Verifier M5", real Step/Continue/Pause/Restart/Stop clicks and real gutter clicks, 2026-09-10): renders; debugger box and watch show honest empty states. Criteria 18 and 19 **pass** — Step from idle parks before line 1, each press advances one line, line 4 stayed lit while its setMove ran (y 45 → 51.5 → 55 over advance()) and line 5 lit only after the 10 cm move completed with the clock frozen at halts; Variables read i = 0…4; a breakpoint on line 6 of a while loop (set by clicking the real gutter, red marker) halted Run three times with the watch `n * 100 + bird.getEncoder('L')` reading 0.637 / 101.273 / 201.91 and Continue resuming each time; the run was recorded with its verdict. Also confirmed: breakpoints follow an inserted line; Pause mid-move then Step finishes the line; Stop and Restart while halted record the run; recursive call stack with per-frame locals and expandable lists/dicts; bad watch expressions report errors harmlessly; all eight error hints appear under the red error and persist into the replay console; ordinary Run/Pause/Resume/Restart/Stop unchanged; the literal Stop-then-Run-repeatedly sequence executed fully. **Persistence pass**: 22 runs and the program survived `cold_restart` dpj-mtv76maq-udyijyg1. **One HIGH finding** (below) → fix milestone 5a. Not exercised: 8× tight-loop stutter.

Re-verifier, fix 5a (first-hand in the browser pane in profile "Verifier 5a" against the freshly fetched bundle containing runInFlight, 2026-09-10): **A pass** — with PUT /api/programs delayed 2.5 s, Run stayed idle while the save was awaited, Restart 0.5 s later started the run, and after the save landed the console read one "Running…" line through "done 3" / "Program finished in 3.11 s." with no "Stopped." line, state finished, pending null, motors 0/0, i = 3; the natural Run-then-Restart case produced one stopped and one finished row. **B pass** — Pause mid-move shows "Paused during line 4 — these are the variables right now…", line 4 highlighted, clock frozen; Resume restores "Running". **C pass** — a run started immediately after renaming announces and records "Renamed 5a". **D pass** — Step from idle, breakpoint halts in a while loop with Continue, Stop, and the ordinary Run/Pause/Resume/Restart/Stop sequence all behave; stopped and finished runs both recorded. **E pass** — three Stop/Run/Restart/Restart bursts each left exactly one surviving run that executed fully to (60, 45, 0°) with no pending move. Persistence: 24 runs and the program survived a reload.

Verifier, milestone 6 (first-hand in the browser pane in profiles "Verifier M6" and "Verifier M6 sibling", real tab clicks, editor tools, hand-off picker, 2026-09-10): renders with no console errors; 10 built-in floors including "Two-Finch dance floor" and "Follow the leader". Criteria 20 and 21 **pass** — both beaks green on two lettered robots; with Finch A's tab set to Tilt left, B drove from y 40 to 54.1 while A stayed put, and B's own tab did not drive it; A driving at B printed getDistance 32 → 2 and halted at a 13.04 cm centre gap (bodies touching, no overlap) with B unmoved. Roadmap confirmed: Start B tool adds and Remove/Undo drops and restores robot B with autosave; per-robot trails and pen ink in two colours; panel tabs only with two robots, each tab's A button and Shake affecting only its robot; clear ValueErrors for Finch('B') on a one-robot floor and Finch('C'); "Finch B: Reach the finish zone" goal passes; inSync gives Pass / "never moved" / "fell out of step … at 1.2 s"; follow gives Pass / "70 cm from A" / "leader only went 20 cm"; two-robot replay draws both robots and trails with tabs working while scrubbing; hand-off copied the program (exercise 14.2), the custom floor with startB and goals, and the workbook attachment (done=false) into the sibling with 0 runs while the source kept its runs and done mark; single-robot regression (Lesson 1 square, Step through a loop, oval lap Pass, single-robot replay) unchanged. **Persistence pass**: both profiles' data survived `cold_restart` dpj-mtva7z46-opw45bre.

Final verifier, whole app (first-hand in the browser pane in profiles "Final verifier" and "Final verifier sibling" against the r273 bundle, 2026-09-10): renders; all empty states present; no favicon request. **All 22 acceptance criteria pass** and **all six fix-pass items pass** (banner clears on the next successful save; out-and-back records 40/40 cm; Floors pane previews only and "Use for" assigns; header clock freezes at run end; "No variables yet." during a fresh run; no favicon 404). Highlights: Lesson 1 square ends on the start mark; pause froze the robot for 3 real seconds; oval tracker covered 511°; walled-box loop stopped at 31 cm with "Pass — stopped 31.1 cm from the wall"; A/Tilt/Shake from the panel; encoder 0.637; SyntaxError and TypeError with line numbers and hints; input() waited for "Ada"; display and buzzer; download bytes identical, import created a program; hand-drawn Y with a box: the follower found the box at 10 cm, returned to the fork and took the other branch; slope gave Beak up/down/Level; floor survived restart and a copy edited independently; circle and fractal tree saved to the gallery; replay scrubbed to the leave-tape moment with line 11/91; goal Pass and "Fail — touched wall at 7.2 s"; Workbook 9.3 raised progress with the correct BirdBrain link; Step one line per press with i in Variables; breakpoint halts with the watch updating; both beaks green and A's tilt drove B; A stopped against B with distance counting 34 → 2; sibling profile empty and the first untouched. **Persistence pass**: programs, floors, 67 runs, 3 drawings and the workbook entry survived `cold_restart` dpj-mtvn2epr-lt30uwvt. **One new HIGH** (below) → fix milestone 8. Relayed only: buzzer audibility, the lesson link opening a tab, the default profile's first-visit auto-run.

## Open

- (HIGH, final verifier → fix 8 in progress) A function that runs long enough to hit the interpreter's yield loses its return value: `x = f()` → NameError on x; `print('a', f())` prints an empty value; `def g(): y = f(); print(y)` prints nothing. Deterministic (4/4) with a 300 000-iteration loop; intermittent (3/6) for a Lesson-9 tracker helper whose loop calls sleep(). Short functions and blocking Finch calls return correctly. Hypothesis: the Sk.yield resume path in public/js/runner.js:124-131 under Sk.configure({yieldLimit:40, killableWhile, killableFor, debugging:true}) with Skulpt 1.2.0. Fix builder launched.
- (low, final verifier) A start mark placed within the robot's body of the floor edge leaves the robot bumping on every move; clampStart only clamps to the floor bounds. public/js/flooreditor.js:554-560.
- (low, final verifier) The watch expression field is not per-profile; a fresh profile shows the previous profile's watch and its NameError.
- (low, final verifier, repeats M4) The floor library list is a small scroll box; custom floors sit below the fold.

- (process) Milestone 1 builder could not check out as a child of the orchestrator identity (PARENT_BRANCH_NOT_FOUND: the parent never created a branch); it re-initialised as a top-level agent per the server's recovery and merged straight to trunk. Later builders will likely do the same. No product impact.
- (RESOLVED at r273, d-7 fix entry) Error banner never cleared after recovery: a failed save leaves "Could not save the program…" on screen even after the next save succeeds. public/js/main.js:18-23, :269; public/js/programs.js:82-90. Deferred to the final fix pass.
- (low, verifier) Header run timer shows the simulation clock and keeps counting after the program finishes ("Finished 17.10 s" vs console "finished in 10.22 s"). public/js/main.js:219-230.
- (low, verifier) The sample program's floor changed to 'maze' from a request the verifier did not send — consistent with the customer trying the app at the same time on the shared unauthenticated profile. Not a defect.
- (low, builder-admitted) Audible buzzer verified as state + WebAudio wiring only.
- (RESOLVED at r273, d-7 fix entry) Same banner defect for floor saves: "Could not save the floor" stays visible after the next save succeeds. Root cause shared with the M1 item: banner() in public/js/main.js:19-24 is never cleared on success; flooreditor.js:458-472. One fix covers both. Deferred to the final fix pass.
- (low, verifier M2) A failed floor save is not retried until the next change. public/js/flooreditor.js:467-471.
- (RESOLVED at r273, d-10 fix entry: Floors pane is preview-only with an explicit "Use for" button) Selecting, copying, or creating a floor in the Floors pane silently rewrote the open program's remembered floor on the server, so a program ends up recorded on a floor she never ran it on and a later delete sends it to blank. flooreditor.js:197, :208, :245 call onSelectFloor → main.js selectFloor → programs.setFloor unconditionally (main.js:218-222). Fix: browsing/editing floors should not reassign the program; only the run-bar Floor select (or an explicit "Use this floor") should. Deferred to the final fix pass.
- (low, verifier M2) Program rename shows in the run banner only after the server round-trip. public/js/programs.js:143-157.
- (RESOLVED at r273, d-15 fix entry: |dl|/|dr|) Per-wheel distance on a run was signed net displacement, not distance travelled: an out-and-back tree run records 0.0 cm per wheel. public/js/sim/world.js:220-221 accumulates signed dl/dr into robot.odometer; recorder.js:108-109 reports it; runs.js:246-248 shows it. Fix: accumulate |dl|, |dr|. Deferred to the final fix pass.
- (RESOLVED in M5/5a, d-23) Twice a freshly started recursive-tree run ended "finished" at ~2.7 s having executed only the first setMove, with no error, both times within seconds of pressing Stop on another running program while finchSandbox.advance() drove the sim alongside the 60 Hz timer. Five later identical attempts ran to completion. Hypothesis: a leftover waiter from the stopped run resolves and mutates robot.pending (world.js:116/137 test `robot.pending !== p`) so the new run's blocking calls resolve early. public/js/runner.js:165-184, public/js/sim/world.js:101-142, public/js/main.js:254-269. **Resolved by the M5 builder (d-23):** the stale-waiter hypothesis did not hold, but a neighbouring real defect was reproduced on trunk — runner.run() awaited stop() with no guard, so two overlapping run() calls started two Skulpt programs sharing the robot and the second's motor calls resolved the first's waiters early. Fixed by sequencing run()/stop() and a runToken in startRun. Re-check in M5 and final verification.
- (RESOLVED — was HIGH, verifier M5; fixed 5a at r201, re-verified) A stale Run request silently stops the newer run: Run pressed with an unsaved edit, then Restart before the save lands, kills the restarted program ("[1.63s] Stopped." with no user Stop) and leaves the robot with a pending move. Deterministic with the program PUT delayed 2.5 s. main.js:294-296 awaits saveNow() then runner.stop() BEFORE checking its runToken; the stopped branch of finishRun (main.js:338-340) does not turn motors off. **Fixed at r201 (d-23 fix entry)**: token checked after every await, runs serialized via runInFlight, parkRobot() on stop. Re-verified 2026-09-10.
- (RESOLVED — was medium, verifier M5; fixed 5a at r201, re-verified) After a user Pause the debugger box said "Running — press Step or Pause to look at the variables" and shows stale values from the last halt. debugpanel.js:185-188, runner.js:277-281, main.js:363-366.
- (low, verifier M6) getDistance() reads 300 (out of range) once A is stopped touching B, since the beak-to-body distance is under 2 cm. Documented design (world.js:18, :359); surprising for Lesson 14 students.
- (low, verifier M6) Runs timeline chart plots Finch A only on a two-robot run; no per-robot toggle. runs.js:13, :287.
- (low, verifier M6) Replay scene ink strokes lose their robot attribution (colours still right). Hypothesis: saved ink omits the robot field. runs.js ~:333.
- (low, verifier M6) A user-stopped run gets no goal verdict even after a lap completed — verdicts only at program end. Pre-existing design (d-20).
- (RESOLVED at r273, d-23 fix entry) While a new run was in progress before any Pause/Step, the Debugger box kept the previous run's final variables under the "Running" status. showRunning() sets status only and never re-renders frames. public/js/debugpanel.js:186-189, main.js:316. Cosmetic.
- (low, verifier M5) Sensor-panel Position readout lagged the robot once while parked. main.js:435-441 / panel.js. Seen once.
- (low, verifier M5) Eight unexplained 404 console entries during the session; app routes all 200/201/304. Likely favicon/probes as in M4.
- (low, verifier M4) A run started within ~1 s of renaming the program is recorded under the old name (name save debounced separately from saveNow; recorder.start snapshots program.name). public/js/main.js:280-289. Related to the M2 low item.
- (low, verifier M4) Adding a goal re-lays out the Floors pane and shifts the tool palette down mid-drawing. #floor-goals above the tool grid.
- (low, verifier M4) Floor library list is a fixed 198 px scroll box; custom floors fall below the fold with 3+. #floor-list.
- (RESOLVED at r273) Two favicon 404s on every page load; inline SVG favicon added.
- (low, verifier M3) During verification another session created ~20 runs in the shared Student profile (17 of "M3 circle") — consistent with the customer trying the app. Not a defect.
