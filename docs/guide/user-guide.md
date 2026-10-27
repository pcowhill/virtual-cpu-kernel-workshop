# User guide

The workbench is a complete small computer you can take apart in the browser: a custom 8-bit CPU, its devices,
boot firmware, and a preemptive multitasking kernel, all written in VC-8 assembly and executed micro-operation by
micro-operation. No server is involved. After the first visit the app also works offline.

## Quick start

The **Start** page has two entry points:

- **Quick start** loads `examples/first-program.asm` in bare-metal mode and opens the CPU lab. Press
  <kbd>F10</kbd> to step one instruction at a time; the first step completes the reset sequence.
- **Boot the operating system** builds the firmware, kernel and four user programs, power-cycles the machine and
  runs it. Follow the boot in **Boot & firmware**, then watch **Processes & scheduling**.

From there, open **Guided lessons** for 18 hands-on walkthroughs or **Examples** for 23 runnable programs with
automated checks, and edit any source in the **Assembly editor**, then press **Build & load**
(<kbd>Ctrl</kbd>+<kbd>Enter</kbd>).

## Layout

- **Top bar**: what is loaded, a warning when the sources changed since loading, the offline/update indicator
  and the theme selector.
- **Control bar**: Power (power-cycle: reload ROM and disk, clear RAM), Reset (reset button: CPU and device
  registers only; RAM is kept), Run/Pause, Stop (back to the power-on state), Step, µStep, clock speed, status,
  privilege mode, PC, cycle and instruction counters. When execution stops, the reason is shown below it.
- **Navigation**: the labs, grouped by workbench, hardware, software and debugger.
- **Dock** (wide screens): registers and the terminal, visible from every lab.

## Keyboard shortcuts

| Key                              | Action                                 |
| -------------------------------- | -------------------------------------- |
| <kbd>F5</kbd>                    | Run / pause                            |
| <kbd>Shift</kbd>+<kbd>F5</kbd>   | Stop (return to the power-on state)    |
| <kbd>F10</kbd>                   | Step one instruction                   |
| <kbd>Shift</kbd>+<kbd>F10</kbd>  | Step one clock cycle (micro-operation) |
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Build & load                           |

When the terminal has focus, typed keys go to the virtual keyboard. <kbd>Tab</kbd> moves focus away and
<kbd>Esc</kbd> leaves the terminal; the function keys keep their debugger meaning.

## Execution speed and runaway programs

The clock setting (2 Hz … 1 MHz, Max) only decides how many simulated cycles run per real second. Results never
depend on it: time inside the machine is counted in cycles. The default is 100 kHz. The machine runs in a Web
Worker, so the page stays responsive even at Max; **Pause** (<kbd>F5</kbd>) always works, including for infinite
loops.

## Labs

| Lab                    | What you can do                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CPU & registers        | Registers, flags, control registers, the current micro-program, disassembly around PC, recent trace. Edit a register (a debugger action, reported as such).                                                                    |
| Datapath & micro-ops   | Step single clock cycles. Highlighted units were used by that micro-operation; the address and data buses light only for an actual transfer and show its value.                                                                |
| Memory & stack         | Hex view of the 64 KiB address space coloured by region, the user protection window, search, the stack from SP upward, watchpoints. Double-click a byte to edit it (debugger action; not allowed on device registers).         |
| Devices                | Terminal, keyboard queue, timer, LEDs and switches, block storage, interrupt controller: their registers and pending interrupt lines.                                                                                          |
| Assembly editor        | Every source file. Assemble (check only) or Build & load. Diagnostics link to lines; clicking a line shows its address and bytes; click the gutter to set a breakpoint (available while the sources match the loaded machine). |
| Boot & firmware        | Boot stages derived from machine state, kernel copy progress, run to `fw_reset` or to the kernel entry.                                                                                                                        |
| Kernel & interrupts    | Exceptions, interrupts and system calls as they happen, time split between user, kernel and idle.                                                                                                                              |
| Processes & scheduling | Configure the programs on the boot disk; the process table and saved contexts decoded from kernel memory; the scheduling timeline.                                                                                             |
| Trace & breakpoints    | Breakpoints and watchpoints by address or label, break-on-exception settings, the instruction trace with register and memory changes.                                                                                          |
| Guided lessons         | See below.                                                                                                                                                                                                                     |
| Examples               | Load an example or **Run & check** it: the check runs the program on the emulator and evaluates its expected behaviour.                                                                                                        |
| Workspaces             | See below.                                                                                                                                                                                                                     |
| Reference              | The instruction set with micro-programs, the specification, kernel documentation and walkthroughs.                                                                                                                             |

Addresses typed into the workbench (breakpoints, watchpoints, memory "Go to") accept labels of the loaded
program and hexadecimal numbers: `start`, `0x2000`, `$2000`, `2000h` or `2000`. Decimal needs `#4096` or
`4096d`. Register values are decimal by default (`42`, `-2`) or hexadecimal with `0x`.

## Guided lessons

Each lesson loads a working machine, explains a concept, and walks you through steps. A step is marked done when
its check is **observed on the running machine**, for example "the CPU is paused about to execute `print`" or
"R0 = 0x0A". A guide panel stays above whichever lab you open. **Show me** performs the step with the ordinary
controls (step, run, set a watchpoint, edit and rebuild), so you can see exactly what it did. **Leave** exits the
lesson and keeps the machine as it is for free experimentation. Progress is remembered in this browser.

Starting a lesson resets breakpoints, watchpoints and the break-on settings to their defaults, because the lessons
are written for them. If you edited a file a lesson relies on (its program, the include files and library, and
for operating-system lessons the firmware and kernel), the lesson page offers to restore the originals.

## Workspaces

A workspace holds your sources and build configuration, debugger settings, experiment notes, the complete machine
state at save time and any number of named snapshots. Workspaces are stored in this browser (IndexedDB).

- **Save** stores the current workspace. **Open** rebuilds its sources and restores the saved machine state, so
  execution continues exactly where it stopped.
- **Take snapshot** captures the machine (registers, memory, devices, storage, pending interrupts, cycle count).
  **Restore** returns to it. A snapshot taken from different sources than the loaded machine is marked; restoring
  it works, but source views may not match.
- **New**, **Duplicate**, **Rename** and **Delete** do what they say. Deleting asks for confirmation, and so does
  anything that would replace unsaved changes (to sources, build configuration, debugger settings, name or notes),
  including reopening the workspace that is already open.
- **Export** downloads a `.vc8.json` file; **Import** reads one back. Imports are validated and never executed
  as code; see [workspace format](../dev/workspace-format.md).

## Offline use

After the first visit every file the workbench needs (application, machine worker, all sources, lessons,
documentation) is cached by a service worker, and the top bar shows **works offline**. When a new version is
deployed, the top bar offers **Update available · reload**; nothing changes until you choose to reload.

## When something goes wrong

- **Guest faults** (illegal instruction, privilege violation, protection fault) are normal machine behaviour: the
  CPU enters an exception handler. With _break on faults_ enabled (default) the debugger pauses just before, and
  the control bar explains the fault. Without a handler the machine stops with a **machine check**.
- **Assembler errors** are listed with file, line and column; the loaded machine is not changed.
- **Workbench errors** (not caused by the guest program) are reported as "Machine host error (workbench, not the
  guest program)". If the background worker cannot start, the workbench runs the machine on the page instead.
