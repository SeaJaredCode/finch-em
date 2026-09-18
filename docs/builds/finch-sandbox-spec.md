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
