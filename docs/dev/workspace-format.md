# Workspace format (version 1)

Workspaces are stored in IndexedDB (database `vc8-workbench`, object store `workspaces`, key `id`) and exported as
UTF-8 JSON files named `*.vc8.json`. Code: `src/app/workspace-format.ts` (format and validation),
`src/app/workspace-db.ts` (storage), `src/app/workspaces.ts` (operations).

## Export file

```jsonc
{
  "format": "vc8-workspace",
  "version": 1,
  "exportedAt": "2026-10-27T19:59:14.000Z",
  "workspace": {
    "name": "My experiment",                 // ≤ 80 characters
    "notes": "free text",                     // ≤ 100 000 characters
    "createdAt": 1761595154000,               // ms since epoch
    "updatedAt": 1761595154000,
    "project": {
      "mode": "bare" | "os",
      "files": { "examples/first-program.asm": "…source…", "include/vc8.inc": "…" },
      "bareMain": "examples/first-program.asm",
      "os": {
        "firmware": "firmware/bios.asm",
        "kernel": "kernel/main.asm",
        "programs": [{ "name": "alpha", "path": "programs/alpha.asm" }]   // ≤ 4
      }
    },
    "debug": {
      "breakpoints": [8192],
      "watchpoints": [[8192, "w"]],           // "r" | "w" | "rw"
      "breakOn": { "faults": true, "traps": false, "interrupts": false },
      "traceEnabled": true,
      "traceCapacity": 5000,
      "speed": 100000 | "max"
    },
    "machine": SnapshotRecord | null,         // state when saved
    "snapshots": [SnapshotRecord, …]          // ≤ 50
  }
}
```

`SnapshotRecord`:

```jsonc
{
  "id": "…", "name": "after boot", "createdAt": 1761595154000,
  "cycle": 400000,
  "label": "operating system: alpha, digits, echo, blinker",   // what was loaded
  "sourceHash": "1a2b3c4d" | null,          // hash of the sources the machine was built from
  "machine": MachineSnapshot
}
```

`MachineSnapshot` (`src/core/machine/machine.ts`) is the complete machine state: `format:
"vc8-machine-snapshot"`, `version: 1`, cycle and instruction counters, the 64 KiB memory image (base64, ROM
included), CPU registers, control registers, internal latches, the micro-program position (so a snapshot may be
taken between two clock cycles of an instruction) and any pending exception, every device's registers and internal
state (timer count, terminal screen, keyboard FIFO, LEDs and switches, storage image (base64) and controller state,
interrupt controller mask), the input log and the per-mode cycle counters. Pending interrupt lines are not stored
separately: they follow from the device states (for example an expired timer with interrupts enabled).

## Validation on import

An import is refused, with a reason shown to the user, unless all of these hold:

1. The file is at most 32 MB and parses as JSON; `format` is `vc8-workspace` and `version` is `1`.
2. Every field has the documented type and limits. Source file names must be relative `.asm`/`.inc` paths without
   `.`/`..` segments; `bareMain`, `firmware`, `kernel` and each program path must name one of the included files
   (an own entry: names such as `constructor` are not files); addresses are 0–0xFFFF; snapshot ids are unique.
3. Each machine snapshot has exactly the structure of a snapshot produced by this version (no missing or extra
   keys; correct types; integers; nothing negative), CPU registers are in range (8-bit registers 0–255, addresses
   0–0xFFFF), device registers hold values the hardware could hold (LEDs, switches, interrupt mask, storage
   registers and keyboard FIFO entries are bytes; the FIFO holds at most 16 keys; timer RELOAD/COUNT are 16-bit;
   the terminal column is within the 80-column screen), it restores
   into a scratch machine, taking a snapshot of that machine reproduces the input exactly, and the scratch machine
   then runs 2 000 cycles without error.

Imported content is data. Sources are only ever assembled by the workshop assembler and executed by the virtual
CPU; snapshots are only ever loaded into the emulator. Nothing is evaluated as JavaScript and no HTML from a file
is rendered.

## Opening and restoring

Opening a workspace replaces the sources, build configuration and debugger settings, builds and loads the
machine, and restores the saved machine state if its `sourceHash` equals the hash of the freshly built sources.
Otherwise the machine starts from power-on and the user is told why. Snapshots can be restored at any time;
those taken from other sources are marked, because source-level views would not match.

## Compatibility

The version number changes when the format changes incompatibly. A reader refuses versions it does not know
rather than guessing.
