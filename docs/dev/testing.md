# Testing approach

Every claim the workbench makes about the machine is checked by running the machine. Tests drive the same code the
app uses (assembler, CPU core, devices, machine host, components) and assert observable state: register values,
memory bytes, terminal output, process tables decoded from kernel memory.

## Commands

```sh
npm test                    # all Vitest projects
npm run test:unit           # ISA conformance, micro-ops, assembler, devices, determinism, host, UI helpers
npm run test:integration    # firmware, kernel, multitasking, catalog examples, lessons
npm run test:component      # Vue components against the in-page machine host (happy-dom)
npm run build && npm run test:e2e        # Playwright against the production build
E2E_BASE_URL=https://pcowhill.github.io/virtual-cpu-kernel-workshop/ npx playwright test   # the deployed site
npm run validate            # lint + format check + typecheck + all Vitest tests + build
```

## Layers

| Layer                   | Where                                                  | What it proves                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ISA conformance         | `tests/unit/isa-conformance.test.ts`, `isa-harness.ts` | Each of the 80 instructions: result, flags (C/Z/N/V), cycle count, PC, privilege behaviour. The harness also checks that nothing _else_ changed.                                                                                                                                                            |
| Micro-op equivalence    | `tests/unit/microops.test.ts`                          | Stepping clock cycles one at a time gives exactly the same state as stepping instructions or running.                                                                                                                                                                                                       |
| Exceptions & protection | `tests/unit/exceptions.test.ts`                        | Precise faults, trap return addresses, exception frames, double fault, machine check, user window and ROM/MMIO rules.                                                                                                                                                                                       |
| Devices                 | `tests/unit/devices.test.ts`                           | Register-level behaviour and timing of timer, terminal, keyboard, GPIO, storage and interrupt controller.                                                                                                                                                                                                   |
| Assembler               | `tests/unit/assembler.test.ts`                         | Encodings for every syntax form, expressions, directives, includes, diagnostics with positions, listings and source maps; disassembler round trips.                                                                                                                                                         |
| Determinism             | `tests/unit/snapshot.test.ts`, `controller.test.ts`    | Identical runs are identical; pause/resume in arbitrary slices equals one run; host speed never changes outcomes; snapshot/restore reproduces the future (also mid-instruction); repeated interrupt sequences are reproducible; breakpoints and watchpoints hold at every slice boundary.                   |
| Machine host            | `tests/unit/controller.test.ts`, `client.test.ts`      | Commands, run-to, checks that suspend debug stops, view publication order, worker failure fallback.                                                                                                                                                                                                         |
| Workspaces              | `tests/unit/workspaces.test.ts`                        | Export/import round trip with continued execution identical to the original; rejection of malformed, incompatible and out-of-range imports; IndexedDB storage operations (via `fake-indexeddb`).                                                                                                            |
| Boot & kernel           | `tests/integration/boot.test.ts`, `kernel.test.ts`     | The ROM loads the kernel from disk by executing instructions; the kernel's syscalls, drivers, isolation, blocking I/O, sleeping, preemption of programs that never yield, register preservation across switches.                                                                                            |
| Catalog                 | `tests/integration/examples.test.ts`                   | Every example runs through the UI's controller path with default debugger settings; each check must fail before the run and pass after it; bare-metal examples must reach HLT.                                                                                                                              |
| Lessons                 | `tests/integration/lessons.test.ts`                    | Every lesson step's check is false before its "Show me" solution and true after it, on the real emulator.                                                                                                                                                                                                   |
| Components              | `tests/component/*.test.ts`                            | Real labs mounted with the in-page host: stepping, breakpoints, watchpoints, diagnostics, datapath highlighting, terminal keys, lessons.                                                                                                                                                                    |
| End to end              | `tests/e2e/*.spec.ts`                                  | Chromium against the production build with the real Web Worker: assemble and inspect bytes, step, breakpoints, run to, registers and memory, boot and preemption, keyboard input, catalog checks, workspaces (save, snapshot, reload, reopen, export, import, delete with confirmation), offline operation. |

## Rules the tests follow

- No test reads values that the machine did not produce: OS state is decoded from kernel memory, never tracked in
  TypeScript.
- Checks are not vacuous: catalog and lesson tests assert that a check fails before the program runs.
- Failing tests are fixed, never skipped or weakened; CI runs all layers and keeps Playwright traces and reports
  as artifacts.

## Regenerated documentation

`docs/spec/isa-reference.md` is generated from the instruction table. `tests/unit/isa-doc.test.ts` fails if it is
out of date; `npm run docs:isa` regenerates it.
