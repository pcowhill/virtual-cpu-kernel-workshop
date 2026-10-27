# Virtual CPU & Kernel Workshop

An educational virtual computer that runs entirely in your browser. You can program it, step through it,
debug it and modify it, from individual CPU micro-operations up to a preemptive multitasking kernel.

**Live: <https://pcowhill.github.io/virtual-cpu-kernel-workshop/>** (works offline after the first visit)

> **VC-8 is a custom, educational 8-bit instruction-set architecture.** It is not compatible with any real
> processor. Everything it does is defined by the specification in [`docs/spec`](docs/spec).

## What is inside

- **A CPU you can watch think.** VC-8 has 8-bit data, 16-bit addresses and 80 instructions. Every instruction
  executes as a micro-program, one micro-operation per clock cycle, with supervisor/user modes, base/limit memory
  protection, precise exceptions and vectored interrupts.
- **Devices on a memory-mapped bus:** a terminal, a keyboard, a timer, LEDs and switches, block storage, and an
  interrupt controller.
- **Real system software, written in VC-8 assembly and executed by the virtual CPU:**
  - a boot ROM that loads the kernel from storage
  - a kernel with system calls, drivers, process control blocks, blocking I/O, sleeping, and timer-driven
    round-robin preemption
  - user programs
- **A workbench:**
  - an assembler and disassembler with diagnostics, listings and source maps
  - a debugger with breakpoints, watchpoints, a trace, micro-stepping and speed control; the machine runs in a
    Web Worker
  - visualizations of the datapath, the memory map, devices, processes and the scheduling timeline
- **18 guided lessons** whose steps are checked against the running machine, and **23 examples** with
  automated checks.
- **Workspaces** in IndexedDB: snapshots of the complete machine state, and versioned, validated import/export.

## Quick start

Open the live site and press **Quick start** to step through a first program with <kbd>F10</kbd>, or **Boot the
operating system** to watch the firmware load the kernel and the kernel schedule four programs. The
[user guide](docs/guide/user-guide.md) explains every lab and control.

| Key                                              | Action                                 |
| ------------------------------------------------ | -------------------------------------- |
| <kbd>F5</kbd> / <kbd>Shift</kbd>+<kbd>F5</kbd>   | Run or pause / stop                    |
| <kbd>F10</kbd> / <kbd>Shift</kbd>+<kbd>F10</kbd> | Step one instruction / one clock cycle |
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd>                 | Build & load                           |

## Development

Requires Node.js 20 or newer.

```sh
npm ci
npm run dev           # development server
npm test              # Vitest: unit, integration and component tests
npm run build         # production build in dist/
npm run test:e2e      # Playwright end-to-end tests (after npm run build)
npm run validate      # lint, format check, typecheck, all Vitest tests, build
npm run docs:isa      # regenerate docs/spec/isa-reference.md from the opcode table
```

See [testing](docs/dev/testing.md) and [deployment](docs/dev/deployment.md).

## Code map

| Path                                   | Contents                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/core/isa`                         | Machine-readable instruction table, constants, reference generator                     |
| `src/core/cpu`                         | Registers, ALU, micro-programs, micro-operation execution                              |
| `src/core/devices`, `src/core/machine` | Devices, bus, machine (stepping, breakpoints, trace, snapshots)                        |
| `src/core/asm`, `src/core/build`       | Assembler, disassembler, ROM/disk image builders                                       |
| `src/core/os`                          | Reading kernel data structures for OS-aware views (read-only)                          |
| `src/guest`                            | All VC-8 sources: `firmware/`, `kernel/`, `programs/`, `examples/`, `lib/`, `include/` |
| `src/host`                             | Machine controller, host loop, Web Worker, client with an in-page fallback             |
| `src/app`                              | Workbench state, project builds, lessons session, workspaces                           |
| `src/catalog`, `src/lessons`           | Example catalog with checks; lesson engine and the 18 lessons                          |
| `src/ui`                               | Labs and components                                                                    |
| `scripts/service-worker.ts`            | Build plugin that generates the offline service worker                                 |
| `tests/`                               | `unit`, `integration`, `component`, `e2e`                                              |

## Documentation

- [User guide](docs/guide/user-guide.md): quick start, controls, labs, lessons, workspaces, offline use
- [Architecture specification](docs/spec/architecture.md): registers, memory map, protection, exceptions,
  devices, power and reset
- [Instruction set reference](docs/spec/isa-reference.md): generated from `src/core/isa/opcodes.ts`
- [Assembly language](docs/spec/assembly-language.md): syntax, expressions, directives, images
- [Boot walkthrough](docs/os/boot-process.md): from reset to the first user program
- [Kernel](docs/os/kernel.md): privilege model, traps, system-call ABI, drivers, process control blocks,
  scheduling
- [Preemption walkthrough](docs/os/preemption-walkthrough.md): a timer interrupt switching processes
- [Workspace format](docs/dev/workspace-format.md), [testing](docs/dev/testing.md),
  [deployment](docs/dev/deployment.md)
- [Authenticity, simplifications and known limitations](docs/limitations.md)

## How it was built

The project was delivered in four milestones, each a reviewed pull request with green CI:

1. architecture and CPU core
2. firmware, kernel and multitasking
3. the workbench
4. lessons, workspaces, offline support and documentation

Each pull request was reviewed by a separate agent with no authoring context. These reviews are disclosed in
the pull requests: they are not human code reviews.
