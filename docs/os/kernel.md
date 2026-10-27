# Workshop Kernel architecture

The Workshop Kernel is a small, complete educational kernel written in VC-8
assembly (`src/guest/kernel/`, about 3 KiB of machine code). It is loaded by
the boot ROM and provides protected processes, system calls, interrupt-driven
devices and timer-driven preemptive round-robin scheduling. All of it executes
on the virtual CPU; see the [boundary table](../spec/architecture.md#9-hardwaresoftware-boundary).

| File                      | Contents                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `main.asm`                | memory layout, PCB and frame layout constants, `kernel_entry`, vector table                                         |
| `trap.asm`                | vector stubs, `trap_entry` (context save), `resume_current` (context restore), timer/keyboard/fault handling, panic |
| `sched.asm`               | `pcb_addr`, `schedule`, `idle`, process creation                                                                    |
| `syscall.asm`             | system-call dispatcher and the ten services                                                                         |
| `drivers.asm`             | terminal, LEDs, timer, keyboard (ring buffer), storage drivers                                                      |
| `lib.asm`, `messages.asm` | console formatting, strings                                                                                         |

## Memory layout

| Range               | Use                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `0x2000–0x4FFF`     | kernel image (code + constant data), loaded from disk                                                          |
| `0x5000–0x51FF`     | kernel variables: `current`, `ticks`, `kframe`, keyboard ring buffer, process table (`proc_table`), `disk_buf` |
| `0x5400–0x57FF`     | four per-process kernel stacks, 256 bytes each                                                                 |
| `0x5A00` / `0x5C00` | idle stack / boot stack tops                                                                                   |
| `0x6000–0xDFFF`     | four user slots of 8 KiB: slot _n_ is `0x6000 + n × 0x2000`                                                    |

## Privilege model

- The kernel always runs in supervisor mode with `PSW.I = 0`. It is therefore
  never interrupted (no locking is needed) and never nests exceptions; an
  exception taken in supervisor mode is a kernel bug and leads to `KERNEL PANIC`.
- User processes run with `PSW = 0x40` (user, interrupts enabled). The CPU's
  protection unit restricts them to their slot (`UBASE`/`ULIMIT` set by the
  kernel before every return to user mode), forbids device and kernel memory,
  and forbids privileged instructions.
- The kernel validates every pointer it receives from user code against the
  caller's window, because supervisor accesses are not restricted by hardware.

## Exceptions and interrupts

| Vector                                  | Kernel handler       | Action                                                                                                          |
| --------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1 illegal, 2 privilege, 3 memory, 5 BRK | `process_fault`      | prints the cause, PC and (memory faults) address; marks the process EXITED with code 255; schedules             |
| 4 `SYS`                                 | `syscall_dispatch`   | see the ABI below                                                                                               |
| 8 IRQ0 timer                            | `timer_interrupt`    | `timer_service` (acknowledge, `ticks++`, wake sleepers), charge the tick, RUNNING → READY, `schedule`           |
| 9 IRQ1 keyboard                         | `keyboard_interrupt` | `kbd_service` (drain the device FIFO into the kernel ring buffer, wake readers), resume the interrupted process |

**What the hardware saves vs. what the kernel saves.** On any exception the CPU
pushes `PC` and `PSW` on the supervisor stack (switching to `KSP` from user
mode). The kernel's vector stub pushes `R0`, `trap_entry` pushes `R1–R7` and the
banked `USP` (read with `MFC USP`). The resulting 13-byte **trap frame**:

| Offset | Saved by | Contents                         |
| ------ | -------- | -------------------------------- |
| 0–1    | kernel   | `USP`                            |
| 2–9    | kernel   | `R7, R6, R5, R4, R3, R2, R1, R0` |
| 10     | CPU      | `PSW`                            |
| 11–12  | CPU      | `PC`                             |

`trap_entry` stores `SP` (the frame address) into the current PCB's `PCB_KSP`.

## Process control block (32 bytes, `proc_table`)

| Offset    | Field                                                  |
| --------- | ------------------------------------------------------ |
| 0         | pid (1–4)                                              |
| 1         | state: 0 free, 1 ready, 2 running, 3 blocked, 4 exited |
| 2         | wait reason: 0 none, 1 keyboard, 2 sleep               |
| 3         | exit code (255 if killed)                              |
| 4–5       | saved kernel SP = address of its trap frame            |
| 6–7 / 8–9 | `UBASE` / `ULIMIT` window                              |
| 10–11     | entry point                                            |
| 12        | sleep ticks remaining                                  |
| 14–15     | timer ticks charged                                    |
| 16–17     | times dispatched                                       |
| 18–19     | system calls made                                      |
| 20–27     | name                                                   |
| 28        | fault cause that killed it                             |
| 29        | slot                                                   |

## Context switching and scheduling

Each process has its own kernel stack, so a context switch is just "save my
frame pointer, load someone else's":

1. An interrupt or system call saves the full context into a frame on the
   current process's kernel stack and records `SP` in its PCB.
2. `schedule` scans the PCBs round robin, starting after `current`, for a READY
   process and marks it RUNNING, then calls `timer_restart`, which gives the
   process a full quantum (`QUANTUM = 2000` cycles) without losing time: it
   stops the timer, counts a tick that expired while the kernel itself was
   running, adds the elapsed part of the interrupted period to `tick_acc`
   (counting a tick whenever that reaches a quantum) and restarts the timer.
   Restarting prevents _interrupt livelock_ (a tick taken immediately after
   `RTI` whenever kernel work approaches a quantum); the accounting keeps
   `ticks` and sleeping processes close to real time however often processes
   yield. It is not exact: the ~300 cycles during which `timer_restart` itself
   has the timer stopped are not counted, so under very yield-heavy load ticks
   run up to about 15% slow. The path from the restart to `RTI` is about 250
   cycles, so a `QUANTUM` below that would still livelock. Then it jumps to
   `resume_current`.
3. `resume_current` loads `SP` from the PCB, loads `UBASE`/`ULIMIT`, pops `USP`
   and `R7…R0`, and executes `RTI`, which restores `PSW` and `PC`.

A new process starts the same way: `proc_create` writes an initial frame (user
`PSW`, entry `PC`, empty registers) so the first dispatch "returns" into it.

**Idle.** If nothing is READY but some process is still alive, `idle` switches
to the idle stack, stops the timer if nobody is sleeping (tickless idle), and
executes `HLT`. VC-8's `HLT` wakes on any pending enabled line even with
`I = 0`, so the kernel then polls `PIC_PENDING`, runs the same `timer_service`
/ `kbd_service` routines the interrupt handlers use, and reschedules. If every
process has exited, the kernel prints a message, masks all interrupt lines and
halts.

**State transitions.**

| From → to         | Cause                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| free → ready      | `proc_create` at boot                                                 |
| ready → running   | `schedule`                                                            |
| running → ready   | timer interrupt (preemption) or `yield`                               |
| running → blocked | `getc` with an empty buffer (wait = keyboard), `sleep` (wait = sleep) |
| blocked → ready   | keyboard interrupt delivers a key / enough timer ticks                |
| running → exited  | `exit`, or a fault (killed)                                           |

A blocked `getc` steps the saved `PC` back by one byte so that `SYS` executes
again when the process is resumed; the retry then finds the key.

## System-call ABI

`R0` = number, `R1` = byte argument, `P1` (= `R2:R3`) = pointer argument, then
`SYS`. On return `R0` = result, `R1` = error code; `R2–R7` and `SP` are
preserved, flags are not. Definitions for programs: `src/guest/include/syscalls.inc`.

| #   | Name      | Arguments                                  | Result                                                                        |
| --- | --------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| 0   | `exit`    | `R1` = code                                | does not return                                                               |
| 1   | `putc`    | `R1` = character                           | `R0 = 1`                                                                      |
| 2   | `puts`    | `P1` = NUL-terminated string (≤ 255 chars) | `R0` = characters written; `E_FAULT` if the string leaves the caller's window |
| 3   | `getc`    | —                                          | `R0` = key; blocks until one arrives                                          |
| 4   | `kbhit`   | —                                          | `R0` = 1 if a key is buffered                                                 |
| 5   | `yield`   | —                                          | gives up the rest of the time slice                                           |
| 6   | `getpid`  | —                                          | `R0` = pid                                                                    |
| 7   | `setled`  | `R1` = pattern                             | LEDs updated by the kernel's GPIO driver                                      |
| 8   | `readblk` | `R1` = block, `P1` = 256-byte buffer       | buffer filled by the kernel's storage driver; `E_FAULT` / `E_IO`              |
| 9   | `sleep`   | `R1` = ticks                               | blocks for that many timer ticks (0 = yield)                                  |

Error codes: `E_OK = 0`, `E_NOSYS = 1` (unknown number; `R0 = 0xFF`),
`E_FAULT = 2`, `E_IO = 3`, `E_INVAL = 4`. With 256-block storage and 8-bit block
numbers, `readblk` cannot actually fail with `E_IO`, and `E_INVAL` is reserved;
both are defined for completeness. A `getc` that blocks and is retried counts as
two system calls in the process statistics (the `SYS` really executes twice).

## Drivers

| Device   | Driver                              | Mode                                                             |
| -------- | ----------------------------------- | ---------------------------------------------------------------- |
| Terminal | `kputc`                             | polls `TERM_STATUS.READY`, writes `TERM_DATA`                    |
| Keyboard | `kbd_service`, `kbd_put`, `kbd_get` | interrupt-driven (IRQ 1) into a 16-byte ring buffer              |
| Timer    | `timer_service`                     | interrupt-driven (IRQ 0), acknowledged by writing `TIMER_STATUS` |
| Storage  | `disk_read`                         | command + status polling + 256-byte programmed-I/O copy          |
| LEDs     | `led_set`                           | writes `GPIO_LEDS`                                               |

## Deliberate simplifications

- At most four processes, created at boot from the boot block; no `fork`/`exec`.
- Fixed 8 KiB slots and bounds-checked (not relocated) addresses: programs are
  assembled for their slot (`PROC_BASE` is predefined by the build). The kernel
  uses a program's position in the boot block as its slot (the `PE_SLOT` field
  is informational); the build refuses to produce a disk if any program fails.
- The system area of the disk ends at block 128, so the kernel and programs
  together must fit in 127 blocks (four programs that each fill their 8 KiB
  slot would not).
- The kernel is non-preemptive and runs with interrupts disabled; there is no
  kernel-mode concurrency.
- The storage driver polls; the storage interrupt line exists but is unused.
- Terminal output is synchronous and the terminal is always ready.
- `ticks` stops counting while the system is idle with no sleepers.
