# Virtual CPU & Kernel Workshop

An educational virtual computer that runs entirely in your browser. You can program it, step through it,
debug it and modify it — from individual CPU micro-operations up to a preemptive multitasking kernel.

> **VC-8 is a custom, educational 8-bit instruction-set architecture.** It is not compatible with any real
> processor. Everything it does is defined by the specification in [`docs/spec`](docs/spec).

## Status

Delivered milestone by milestone through pull requests. Live site:
<https://pcowhill.github.io/virtual-cpu-kernel-workshop/>

| Milestone                                    | Contents                                                                                                       | State       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------- |
| 1 — Architecture and foundation              | Specification, ISA table, micro-op CPU core, protection, exceptions, interrupts, devices, assembler, CI        | merged      |
| 2 — Firmware, kernel, multitasking           | Boot ROM, kernel, system calls, drivers, round-robin preemptive scheduler, integration tests                   | merged      |
| 3 — Workbench                                | Worker-hosted machine, debugger, datapath/memory/timeline/device views, editor, example catalog, e2e workflows | in review   |
| 4 — Lessons, workspaces, offline, deployment | Guided lessons, IndexedDB workspaces, PWA offline support, remaining documentation                             | in progress |

## The workbench

The app has one simulated machine, owned by a Web Worker (or by the main thread when workers are unavailable).
The interface only sends commands — run, pause, step one instruction, step one clock cycle, load, poke — and
renders the snapshots the machine publishes. Labs:

- **CPU & registers**, **Datapath & micro-ops** — step instructions (<kbd>F10</kbd>) or single clock cycles
  (<kbd>Shift</kbd>+<kbd>F10</kbd>); the datapath highlights only the units the last micro-operation used.
- **Memory & stack** — hex view of the whole address space, region map, protection window, watchpoints.
- **Devices** — terminal, keyboard, timer, LEDs/switches, block storage, interrupt controller.
- **Assembly editor** — every source file (examples, firmware, kernel, programs); diagnostics; listing and
  line ↔ byte mapping; gutter breakpoints. Building is explicit (<kbd>Ctrl</kbd>+<kbd>Enter</kbd>).
- **Boot & firmware**, **Kernel & interrupts**, **Processes & scheduling** — OS-aware views decoded from kernel
  memory: boot stages, interrupt and syscall log, process table, scheduling timeline.
- **Trace & breakpoints** — bounded instruction trace, breakpoints, break-on-exception settings.
- **Examples** — 23 catalog programs, each with automated checks run on the emulator.
- **Reference** — instruction set (with micro-programs), specification, kernel and walkthrough documents.

## Development

```sh
npm ci
npm run dev          # local development server
npm test             # all Vitest projects (unit, integration, component)
npm run test:e2e     # Playwright end-to-end tests (after `npm run build`)
npm run validate     # lint, format check, typecheck, tests, build
npm run docs:isa     # regenerate docs/spec/isa-reference.md from the opcode table
```

## Documentation

- [Architecture specification](docs/spec/architecture.md) — registers, memory map, protection, exceptions, devices
- [Instruction set reference](docs/spec/isa-reference.md) — generated from `src/core/isa/opcodes.ts`
- [Boot process walkthrough](docs/os/boot-process.md) — from reset to the first user program
- [Kernel](docs/os/kernel.md) — traps, system calls, drivers, process control blocks, scheduling
- [Preemption walkthrough](docs/os/preemption-walkthrough.md) — a timer interrupt switching processes
