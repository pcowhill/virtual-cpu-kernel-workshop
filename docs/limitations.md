# Authenticity, simplifications and known limitations

## What is authentic to the simulated design

Within its own specification ([architecture](spec/architecture.md)), the VC-8 machine behaves the way real hardware
does. Nothing below is approximated or animated by the workbench.

- **Every instruction runs as micro-operations**, one per clock cycle, through the same micro-programs whether you
  step cycles, step instructions or run at full speed. Cycle counts in the reference are the counts the machine
  executes.
- **Devices advance every cycle.** The timer counts cycles, storage takes 64 cycles per command, and interrupts are
  sampled at instruction boundaries.
- **Protection is enforced by the CPU.** Every user-mode access is checked against `[UBASE, ULIMIT)`, privileged
  instructions fault, and faults are precise.
- **The firmware really boots the system.** The ROM reads the boot block and kernel blocks through the storage
  controller's data port and copies them into RAM with ordinary stores. The workbench never places the kernel in
  memory.
- **The kernel really runs the processes.** Traps, interrupt handlers, context save/restore, the scheduler,
  sleeping, blocking keyboard input and the drivers are all VC-8 machine code. Process tables, timelines and saved
  contexts in the UI are decoded from kernel memory.
- **Execution is deterministic.** Identical start states and inputs give identical results, independent of the
  clock setting, pausing, or snapshot/restore.

## Deliberate educational simplifications

**The CPU and memory**

- One micro-operation per clock cycle and single-cycle memory: there are no caches, pipelining, wait states or
  bus arbitration.
- 8-bit data with 16-bit addresses and a flat 64 KiB space. Protection is a single base/limit window with no
  paging, no virtual memory and no relocation; each process is assembled for its own fixed 8 KiB slot.

**The devices**

- Storage is 256 blocks of 256 bytes with programmed I/O only: no DMA and a fixed latency.
- The terminal is always ready.

**The kernel** ([details](os/kernel.md#deliberate-simplifications))

- At most four processes, created at boot, with no `fork`/`exec`.
- Round-robin scheduling only.
- No file system: there is a raw block-read call.
- The kernel itself is not preemptible.
- `ticks` is not exact wall-clock time: see the timekeeping note in the kernel documentation.

**The workbench**

- For bare-metal experiments, the build can preload RAM before power-on. This is a debugger convenience and is
  labelled as one; the operating system build never uses it.
- Debugger edits of registers and memory are explicit, labelled actions. They bypass protection by design, but are
  not allowed on device registers.

## Known limitations of the application

- **Long automated checks block the worker.** "Run & check" and lesson "Show me" runs execute synchronously in the
  machine worker; the longest takes about 6 million cycles, roughly a second. The page stays responsive, but such a
  check cannot be paused halfway.
- **Maximum speed depends on the host.** The "Max" setting reaches about 5 million cycles per second on a typical
  desktop.
- **The datapath shows units, not transfers.** It highlights the units each micro-operation used and the actual
  bus transfers, but the core does not record the individual transfers between internal units, so internal wires
  are drawn as structure only.
- **OS views depend on the kernel's data layout.** They find the process table through kernel symbols
  (`proc_table`, `PCB_SIZE` and the field offsets). If you rename or remove those in the kernel source, the views
  show nothing rather than guessing.
- **Lessons expect the shipped sources and default debugger settings.** If you edited a file a lesson uses (its
  program, the include files and library, and for OS lessons the firmware and kernel), its checks may become
  unreachable; the lesson page lists the edited files and offers to restore them. Starting a lesson resets
  breakpoints, watchpoints and break-on settings (Leave restores them).
- **Workspaces live in one browser.** Clearing site data deletes them, and browser storage quotas apply. Export
  anything you want to keep.
- **Only Chromium is tested automatically.** The app uses standard APIs (module Web Workers, IndexedDB, service
  workers), and the machine falls back to running on the page if a worker cannot start.
- **Small screens are not the target.** On narrow screens the register and terminal dock is hidden, and the editor
  is a plain text area without autocompletion.
