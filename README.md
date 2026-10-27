# Virtual CPU & Kernel Workshop

An educational virtual computer that runs entirely in your browser. You can program it, step through it,
debug it and modify it — from individual CPU micro-operations up to a preemptive multitasking kernel.

> **VC-8 is a custom, educational 8-bit instruction-set architecture.** It is not compatible with any real
> processor. Everything it does is defined by the specification in [`docs/spec`](docs/spec).

## Status

Work in progress, delivered milestone by milestone through pull requests.

| Milestone                                    | Contents                                                                                                                                                                   | State   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1 — Architecture and foundation              | Specification, machine-readable ISA, CPU core with micro-operations, memory protection, exceptions and interrupts, devices, assembler, disassembler, conformance tests, CI | this PR |
| 2 — Firmware, kernel, multitasking           | Boot ROM, kernel, system calls, drivers, round-robin scheduler, integration tests                                                                                          | planned |
| 3 — Workbench                                | Worker-hosted machine, debugger, visualisations                                                                                                                            | planned |
| 4 — Lessons, workspaces, offline, deployment | Guided lessons, example catalog, IndexedDB workspaces, PWA                                                                                                                 | planned |

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
