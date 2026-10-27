# Boot process and walkthrough: from reset to the first user program

Everything below happens through VC-8 instructions executed by the virtual CPU.
The host (the workbench) only provides the _contents_ of the boot ROM chip and
of the storage medium before power-on — exactly what a real machine has when you
switch it on. It never copies the kernel into RAM and never starts a process.

Source files: [`src/guest/firmware/bios.asm`](../../src/guest/firmware/bios.asm),
[`src/guest/kernel/`](../../src/guest/kernel). Numbers below are for a build with the
programs `hello` and `spinner` at the time of writing; addresses move if you edit the
sources, which is why the workbench always shows symbols.

## 1. What exists at power-on

| Component                | Contents                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------- |
| Boot ROM `0x0000–0x1FFF` | the assembled firmware (1 111 bytes): a vector table at `0x0000` and code from `0x0040` |
| RAM `0x2000–0xEFFF`      | all zero                                                                                |
| Storage                  | a disk image built by the workstation: boot block, kernel, programs, data               |
| CPU                      | reset state: supervisor mode, interrupts off, `VBASE = 0x0000`                          |

The boot disk layout (all built by `src/core/build/system.ts`):

| Block(s) | Contents                                                                              |
| -------- | ------------------------------------------------------------------------------------- |
| 0        | boot block: magic `"VK"`, version, kernel location/size/entry/checksum, program table |
| 1–12     | kernel image (load address `0x2000`)                                                  |
| 13…      | user program images, one after another                                                |
| 128…     | data area (block 128 holds a text file read by the `reader` program)                  |

Boot block fields are defined in `src/guest/include/vc8.inc` (`HDR_*`, `PE_*`).

## 2. Reset (cycles 0–4)

The CPU's reset sequence is five micro-operations: `MAR ← 0x0000`, read the low
byte, `MAR ← MAR + 1`, read the high byte, `PC ← 0x0040`. Entry 0 of the ROM's
vector table is the address of `fw_reset`. Step it with **micro-step** in the
workbench's Datapath lab (milestone 3) to watch each bus transaction.

## 3. Firmware (cycles 5 – ~132 000, ~21 800 instructions)

`fw_reset` runs in supervisor mode from ROM:

1. `MOVP SP, #0x6000` — a stack at the top of kernel RAM.
2. Clears the terminal and prints the banner through the terminal driver
   `fw_putc` (polls `TERM_STATUS`, writes `TERM_DATA`).
3. Reads `SYS_ID` and checks it is `'V'`.
4. Probes the storage controller (`DISK_CMD ← REWIND`, `DISK_ERRCODE`,
   `DISK_BLOCKS`).
5. `fw_disk_read` with block 0: writes `BLOCK_LO/HI`, writes `CMD ← READ`, then
   polls `STATUS` until `DONE` (the controller is busy for 64 cycles).
6. Reads the boot block one byte at a time from the `DATA` port, validates the
   magic and version, and stores the kernel's block, count, load address, entry
   and checksum in firmware variables at `0x5F00`.
7. **Copies the kernel**: for each of the 12 kernel blocks it issues a READ,
   then executes the loop

   ```asm
   .copy:  LD R0, [DISK_DATA]   ; next byte from the controller buffer
           ST [P1], R0          ; ... into kernel RAM
           ADD R5, R0           ; running checksum
           INCP P1
           DEC R4
           JNE .copy
   ```

   3 072 times in total, printing a dot per block. Watch kernel RAM fill in the
   Memory lab, or set a write watchpoint on `0x2000`.

8. Compares the checksum with the boot block's, prints `checksum OK`.
9. `LDW P0, [fw_kentry]` then `JMP P0` — control reaches `kernel_entry`
   (`0x2000`) at about cycle 132 339, still in supervisor mode with interrupts
   disabled.

Before copying, the firmware also checks the layout the boot block describes:
the kernel must start after block 0 and end within the disk, load at a
256-byte-aligned address inside kernel RAM below the firmware's own variables
(`0x5F00`), and have its entry point inside the image.

Failure paths (bad magic or version, invalid layout, checksum mismatch, storage
error, unexpected exception) print a message and halt with every interrupt line
masked. `tests/integration/boot.test.ts` exercises the bad-magic, invalid-layout,
checksum and empty-disk paths; the storage-error and unexpected-exception paths
cannot be reached with a valid layout on this hardware and are not tested.

## 4. Kernel initialisation (to ~cycle 200 000)

`kernel_entry` (`kernel/main.asm`):

1. Switches to its own boot stack (`KSTACK_BOOT = 0x5C00`).
2. `MTC VBASE, P0` with the address of `kvectors` — from now on exceptions and
   interrupts enter the kernel's handlers.
3. Clears the kernel data area (`0x5000–0x51FF`).
4. Reads the boot block again with its own storage driver (`disk_read` in
   `drivers.asm`) into `disk_buf`.
5. For each program entry, `proc_create`:
   - fills a process control block (pid, name, memory window
     `0x6000 + slot × 0x2000`, entry point),
   - validates that the image fits its window,
   - loads the image with `disk_read` directly into the slot,
   - builds an **initial trap frame** at the top of the process's kernel stack:
     `USP` = top of the slot, `R0–R7 = 0`, `PSW = 0x40` (user mode, interrupts
     on), `PC` = entry point — exactly the frame an interrupt would have left.
6. Programs the timer (`RELOAD = 2000`, periodic, interrupt enabled), enables
   the keyboard interrupt, unmasks lines 0 and 1 in the interrupt controller.
7. Jumps to `schedule`.

## 5. The first user instruction (~cycle 200 939)

`schedule` picks process 0 (round robin from "none"), marks it RUNNING (the
timer was started at the end of initialisation and keeps ticking) and jumps to
`resume_current`, which:

```asm
LDW SP, [P3+PCB_KSP]    ; the process's kernel stack (its frame)
LDW P0, [P3+PCB_BASE]
MTC UBASE, P0           ; memory window for the protection unit
LDW P0, [P3+PCB_LIMIT]
MTC ULIMIT, P0
POPP P3
MTC USP, P3             ; user stack pointer
POP R7 ... POP R0       ; general registers
RTI                     ; PSW = 0x40 -> user mode; PC = 0x6000
```

`RTI` pops `PSW = 0x40`, so the CPU drops to user mode, `SP` now means `USP`,
and execution continues at `0x6000`, the first instruction of `hello`. From here
on the CPU's protection unit only lets this code touch `0x6000–0x7FFF`.

## 6. The first system call (~cycle 200 965)

`hello` executes `SYS` with `R0 = 2` (puts) and `P1` pointing at its greeting:

1. Hardware: the CPU pushes `PC = 0x6008` and `PSW = 0x40` on the kernel stack
   (switching to `KSP` because it came from user mode), sets supervisor mode,
   masks interrupts and jumps through vector 4 to `vec_syscall`.
2. Kernel: `vec_syscall` pushes `R0`, `trap_entry` pushes `R1–R7` and `USP`,
   records the frame pointer in the PCB and dispatches through `syscall_table`
   to `sys_puts`.
3. `sys_puts` checks every byte's address against the caller's window (the
   kernel can read anything, so it must not trust user pointers) and prints via
   `kputc`.
4. `sys_return` stores the results into the saved `R0`/`R1` slots of the frame
   and jumps to `resume_current`; `RTI` returns to `0x6008` in user mode.

The terminal now shows `Hello from user mode! I am pid 1`.
