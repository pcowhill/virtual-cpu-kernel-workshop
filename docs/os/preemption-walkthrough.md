# Walkthrough: timer-driven preemption

This walkthrough follows two processes that never give up the CPU voluntarily.
Each `spinner` only increments a counter in its own memory; its loop contains no
system calls. The only way for the other process to run is that the timer
interrupts the CPU and the kernel switches context.

Reproduce it in the workbench (milestone 3) with the **Preemptive multitasking**
example, or in tests with `tests/integration/kernel.test.ts` ("two compute-bound programs…").
Cycle numbers below come from the default build at the time of writing.

## Setup

- The kernel programmed the timer at boot: `RELOAD = 2000`, `EN | IE | PERIODIC`,
  and unmasked IRQ line 0 in the interrupt controller.
- Every dispatch calls `timer_restart`, which accounts for the time already
  used, then restarts the timer: each dispatched process gets a full
  2000-cycle quantum.
- Process 1 (`spinner`, window `0x6000–0x7FFF`) and process 2 (`spinner`,
  window `0x8000–0x9FFF`) are both READY.

## One preemption, step by step

1. **User mode, process 1.** The CPU executes `INCP P2 / STW [counter], P2 /
CMPP P2, #LIMIT / JNE .loop` in user mode. `PSW = 0x40`: interrupts enabled.
2. **The timer expires.** After 2000 cycles the timer sets `EXPIRED`; since
   `IE = 1`, IRQ line 0 is asserted. The interrupt controller's `MASK` has bit 0
   set, so `PENDING & MASK ≠ 0`.
3. **Instruction boundary.** The CPU only samples interrupts between
   instructions. At the next boundary, with `PSW.I = 1`, it starts the 12-cycle
   exception-entry sequence instead of fetching:
   - `TMP ← PSW (0x40)`, `CAUSE ← 0x20`, `PSW ← supervisor, I = 0` — `SP` now
     names `KSP`, the kernel stack of process 1;
   - push `PC` (high, low) and the old `PSW`;
   - read the handler address from `VBASE + 2 × 8` and jump to `vec_timer`.
4. **Kernel saves the context.** `vec_timer` pushes `R0` and sets `R0 = 8`;
   `trap_entry` pushes `R1–R7`, reads the banked user stack pointer with
   `MFC P3, USP` and pushes it. The 13-byte frame is complete; the kernel stores
   its address in process 1's PCB (`PCB_KSP`).
5. **Timer service.** `timer_interrupt` calls `timer_service`, which writes
   `TIMER_STATUS ← 1` (acknowledge: the IRQ line drops), increments `ticks` and
   checks sleepers. Process 1 is charged one tick and moved RUNNING → READY.
6. **Scheduling decision.** `schedule` scans round robin after `current = 0`,
   finds process 2 READY, sets `current = 1`, marks it RUNNING and calls
   `timer_restart` (account for elapsed time, restart for a full quantum).
7. **Restore the other context.** `resume_current` loads `SP` from process 2's
   PCB — a different kernel stack holding process 2's frame from its last
   preemption — sets `UBASE = 0x8000`, `ULIMIT = 0xA000`, restores `USP` and
   `R7…R0`, and executes `RTI`.
8. **User mode, process 2.** `RTI` pops `PSW = 0x40` and process 2's `PC`. The
   protection unit now only allows `0x8000–0x9FFF`. Process 2 continues exactly
   where it was interrupted, with all its registers intact.

In the build used here the kernel part (steps 3–8) takes about 1 100–1 600 cycles,
and the next process then runs for a full quantum (up to about 1 750 cycles of
user code before the next tick, after the restart and the return path).

## What to observe in the workbench

- **Processes & Scheduling lab:** the timeline alternates between pid 1 and pid 2
  with a timer marker at every switch; selecting a marker shows the interrupted
  PC and the process's saved registers.
- **Kernel & Interrupts lab:** the exception trace shows vector 8 entries from
  user mode, each followed by an `RTI` to the _other_ window.
- **Memory lab:** both `counter` variables grow in turn; neither process ever
  executes a system call until it finishes.
- **Datapath lab:** micro-step through an exception entry to see the three
  frame bytes written by the hardware.
- **Guided lesson 17** (_Timer-driven preemptive multitasking_) runs this setup
  and has you shorten the quantum; lesson 16 follows the saved contexts.

## Things to try

- Change `QUANTUM` in `kernel/main.asm`, rebuild and reboot: smaller quanta mean
  more switches and a larger share of kernel time. Below about 250 cycles (the
  kernel's path from restarting the timer to `RTI`) no process can make progress.
- Remove the `CALL timer_restart` in `schedule` and set `QUANTUM`
  below the handler's cost: the timer fires again before the process executes a
  single instruction — _interrupt livelock_, which this kernel was written to
  avoid.
- Run `regcheck` alongside `spinner`: it fills every register with a pattern
  and verifies it across preemptions, proving the context switch is complete.
