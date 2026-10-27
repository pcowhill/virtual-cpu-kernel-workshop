# VC-8 Workshop Machine — Architecture Specification

**Specification version:** 1.0
**Status:** normative for the emulator, assembler, disassembler, firmware and kernel in this repository.

> **VC-8 is a custom, educational instruction-set architecture.** It is not compatible with,
> derived from, or a model of x86, ARM, RISC-V, 6502, Z80 or any other real processor.
> Familiar ideas (banked stack pointers, vectored interrupts, base/limit protection,
> memory-mapped I/O) are borrowed because they are good teaching material, but every
> encoding and behaviour below is defined by this document alone.

The per-opcode reference (every opcode, encoding, length, flags, cycle count and
privilege rule) is generated from the machine-readable table in
`src/core/isa/opcodes.ts` and lives in [`isa-reference.md`](isa-reference.md). The
same table drives the assembler, the disassembler, the emulator decoder and the
in-app reference, so they cannot disagree.

---

## 1. Overview

| Property                  | Value                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| Data path                 | 8 bits (registers, ALU, data bus)                                |
| Address space             | 16 bits, 65 536 bytes, byte addressed                            |
| Byte order                | Little-endian for every 16-bit quantity stored in memory         |
| General-purpose registers | 8 × 8-bit (`R0`–`R7`), usable as 4 × 16-bit pairs (`P0`–`P3`)    |
| Stack                     | Full-descending, two banked 16-bit stack pointers (`KSP`, `USP`) |
| Privilege levels          | Supervisor and User                                              |
| Instruction length        | 1–4 bytes, 8-bit opcode first                                    |
| Exceptions                | Vectored, 16 vectors, precise for faults                         |
| Protection                | CPU-enforced region rules plus a per-process base/limit window   |
| Timing                    | 1 micro-operation = 1 simulated clock cycle                      |

## 2. Programmer-visible state

### 2.1 General-purpose registers

`R0`–`R7` are 8-bit registers. Every value is an 8-bit pattern; arithmetic wraps
modulo 256. Instructions do not distinguish signed from unsigned values — the
flags report both interpretations (see §4).

Pairs of registers form 16-bit **pair registers** used for addresses and 16-bit
arithmetic:

| Pair | High byte | Low byte |
| ---- | --------- | -------- |
| `P0` | `R0`      | `R1`     |
| `P1` | `R2`      | `R3`     |
| `P2` | `R4`      | `R5`     |
| `P3` | `R6`      | `R7`     |

A pair is not a separate register: writing `P1` changes `R2` and `R3`, and
writing `R3` changes the low byte of `P1`.

### 2.2 Wide-register field

Instructions that take a 16-bit register use a 4-bit **wide-register field**:

| Code | Register                                    |
| ---- | ------------------------------------------- |
| 0–3  | `P0`–`P3`                                   |
| 4    | `SP` (the _active_ stack pointer, see §2.4) |
| 5–15 | invalid — **illegal-instruction fault**     |

An 8-bit register field uses codes 0–7 for `R0`–`R7`; codes 8–15 raise an
illegal-instruction fault. Unused register fields must be zero; a non-zero
unused field is an invalid encoding and raises an illegal-instruction fault.

Fault precedence within one instruction follows the micro-program order:
opcode fetch (memory fault) → decode (illegal opcode, then privilege) →
operand fetch and register-field validation (illegal instruction) → data
accesses (memory fault). For example, a privileged opcode with an invalid
register byte executed in user mode raises a privilege fault.

### 2.3 Program counter

`PC` is 16 bits and wraps modulo 65 536. It always holds the address of the next
byte the CPU will fetch.

### 2.4 Stack pointers

The CPU has two physical 16-bit stack pointers:

- `KSP` — supervisor (kernel) stack pointer.
- `USP` — user stack pointer.

`SP` in an instruction means the **active** stack pointer: `KSP` while
`PSW.S = 1`, `USP` while `PSW.S = 0`. The inactive one is preserved untouched
and is reachable by the supervisor through the `USP` control register.

The stack is **full-descending**: a push first decrements `SP` then writes the
byte at the new `SP`; a pop reads the byte at `SP` then increments `SP`. 16-bit
values are pushed high byte first, so they appear little-endian in memory.
Stack-pointer arithmetic wraps modulo 65 536.

### 2.5 Processor status word (PSW)

| Bit | Name | Meaning                                                   |
| --- | ---- | --------------------------------------------------------- |
| 0   | `C`  | Carry (addition) / borrow (subtraction) / shifted-out bit |
| 1   | `Z`  | Zero result                                               |
| 2   | `N`  | Negative — bit 7 (or bit 15 for 16-bit ops) of the result |
| 3   | `V`  | Signed (two's-complement) overflow                        |
| 4–5 | —    | Reserved, always read as 0, writes ignored                |
| 6   | `I`  | Interrupt enable (1 = maskable interrupts may be taken)   |
| 7   | `S`  | Supervisor mode (1 = supervisor, 0 = user)                |

User code changes `C/Z/N/V` through ordinary instructions plus `CLC`/`SEC`.
`I` and `S` change only through privileged instructions (`CLI`, `STI`, `MTC PSW`,
`RTI`) and through exception entry.

### 2.6 Control registers

Control registers are 16 bits wide and accessible **only in supervisor mode**,
with `MFC Pd, CRn` (move from control) and `MTC CRn, Ps` (move to control). Any
use in user mode raises a privilege fault.

| #   | Name       | Reset    | Access | Purpose                                                                 |
| --- | ---------- | -------- | ------ | ----------------------------------------------------------------------- |
| 0   | `PSW`      | `0x0080` | R/W    | Processor status word (low byte; high byte reads 0, writes ignored)     |
| 1   | `USP`      | `0x0000` | R/W    | User stack pointer (the inactive bank while in supervisor mode)         |
| 2   | `VBASE`    | `0x0000` | R/W    | Base address of the exception vector table                              |
| 3   | `UBASE`    | `0x6000` | R/W    | First address of the user-mode access window                            |
| 4   | `ULIMIT`   | `0xF000` | R/W    | First address _after_ the user-mode access window                       |
| 5   | `CAUSE`    | `0x0000` | R      | Cause code of the most recent exception (§6.3); writes ignored          |
| 6   | `FADDR`    | `0x0000` | R      | Faulting memory address of the most recent memory fault; writes ignored |
| 7   | `KSCRATCH` | `0x0000` | R/W    | Free supervisor scratch register                                        |

Control-register numbers 8–15 are invalid encodings (illegal-instruction fault).

Writing `PSW` with `MTC` takes effect immediately: if the new `S` is 0 the CPU is
in user mode from the next fetch on, and `SP` then names `USP`.

### 2.7 Reset state

Power-on and reset set:

- `R0`–`R7 = 0`, `KSP = 0`, `USP = 0`
- `PSW = 0x80` (supervisor, interrupts disabled, flags clear)
- `VBASE = 0x0000`, `UBASE = 0x6000`, `ULIMIT = 0xF000`, `CAUSE = FADDR = KSCRATCH = 0`
- all internal latches cleared, no pending exception

The CPU then executes the **reset sequence** as five visible micro-operations:
`MAR ← 0x0000`, read the reset vector's low byte, `MAR ← MAR + 1`, read the high
byte, `PC ← vector`. Execution starts at that address in supervisor mode with
interrupts disabled. Because `VBASE` resets to `0x0000`, the reset vector is
entry 0 of the boot ROM's vector table.

## 3. Memory architecture

### 3.1 Memory map

| Range           | Size   | Region            | Supervisor           | User                          |
| --------------- | ------ | ----------------- | -------------------- | ----------------------------- |
| `0x0000–0x1FFF` | 8 KiB  | Boot ROM          | read, execute        | no access                     |
| `0x2000–0x5FFF` | 16 KiB | Kernel RAM        | read, write, execute | no access                     |
| `0x6000–0xEFFF` | 36 KiB | User RAM          | read, write, execute | only inside `[UBASE, ULIMIT)` |
| `0xF000–0xFFFF` | 4 KiB  | Memory-mapped I/O | device registers     | no access                     |

RAM powers up as `0x00`. Unprogrammed ROM bytes read as `0xFF`.

### 3.2 Protection rules

Every CPU memory access — instruction fetch, operand fetch, data read, data
write, stack push/pop and vector fetch — is checked by the memory-protection
unit before it reaches memory or a device:

**Supervisor mode**

1. A write to ROM → memory fault, cause `ROM_WRITE`.
2. An access to an MMIO address not decoded by any device, or any instruction
   fetch from MMIO space → memory fault, cause `BUS_ERROR`.
3. Everything else is permitted.

**User mode**

An access is permitted only if the address is inside User RAM
(`0x6000–0xEFFF`) **and** inside the window `UBASE ≤ addr < ULIMIT`. Otherwise a
memory fault is raised with cause `FETCH_VIOLATION`, `READ_VIOLATION` or
`WRITE_VIOLATION` according to the access type. The window is a _bounds check_,
not relocation: user programs use real addresses.

The kernel isolates processes by loading each process's own window into
`UBASE`/`ULIMIT` before returning to it. Because those registers are privileged,
user code cannot widen its window, and because the region rule is applied in
addition to the window, even a misconfigured window can never expose ROM,
kernel RAM or devices to user mode.

16-bit memory accesses are two byte accesses, each checked independently.
Loads (`LDW`, `POPP`, `RET`, `RTI`) and stores to a given address (`STW`) touch
the low address first. Pushes (`PUSHP`, `CALL`, exception entry) write the
_higher_ address first, because they move down the stack. A multi-byte write
whose later byte faults leaves the earlier byte(s) written. Registers, `SP`,
flags and `PC` are still restored exactly, so the fault is reported precisely,
but memory below the stack pointer (or the first byte of an `STW`) may have
changed (documented simplification: stores are not transactional).

The protection unit checks addresses only. The supervisor may access every
user window, so a kernel that accepts pointers from user programs must check
them in software (the reference kernel does this for every system call).

### 3.3 Device decoding

Each device owns a 16-byte block in MMIO space. Inside a block, offsets without
a defined register read as `0x00` and ignore writes. Addresses outside every
block raise `BUS_ERROR`. See §8.

Debugger memory views read device registers **without** side effects (for
example, viewing the keyboard data register does not dequeue a key). Guest reads
always have their defined side effects.

## 4. Arithmetic and flags

All 8-bit arithmetic wraps modulo 256 and all 16-bit arithmetic modulo 65 536.

| Operation                              | C                                  | Z                 | N                | V                      |
| -------------------------------------- | ---------------------------------- | ----------------- | ---------------- | ---------------------- |
| `ADD`, `ADC`                           | carry out of bit 7                 | result = 0        | bit 7            | signed overflow        |
| `SUB`, `SBC`, `CMP`, `NEG`             | **borrow** (1 if unsigned `a < b`) | result = 0        | bit 7            | signed overflow        |
| `AND`, `OR`, `XOR`, `NOT`, `TST`       | 0                                  | result = 0        | bit 7            | 0                      |
| `INC`, `DEC`                           | unchanged                          | result = 0        | bit 7            | signed overflow        |
| `SHL`, `ROL`                           | old bit 7                          | result = 0        | bit 7            | 0                      |
| `SHR`, `SAR`, `ROR`                    | old bit 0                          | result = 0        | bit 7            | 0                      |
| `ADDP`, `SUBP`, `CMPP`                 | carry/borrow out of bit 15         | 16-bit result = 0 | bit 15           | 16-bit signed overflow |
| `INCP`, `DECP`                         | unchanged                          | 16-bit result = 0 | unchanged        | unchanged              |
| `CLC` / `SEC`                          | 0 / 1                              | unchanged         | unchanged        | unchanged              |
| `RTI`, `MTC PSW`                       | restored/written                   | restored/written  | restored/written | restored/written       |
| moves, loads, stores, push, pop, jumps | unchanged                          | unchanged         | unchanged        | unchanged              |

`ADC` adds `C`; `SBC` subtracts `C` (borrow). `ROL`/`ROR` rotate through carry
(a 9-bit rotation). `NEG` computes `0 − a`. Signed overflow for addition is set
when both operands have the same sign and the result's sign differs; for
subtraction when the operands' signs differ and the result's sign differs from
the first operand.

`ADDP W, R` adds the zero-extended 8-bit register to the 16-bit register.

Because the ALU is 8 bits wide, 16-bit additions/subtractions take two ALU
micro-operations (low byte, then high byte with the carry from the low byte).
`INCP`/`DECP` use the separate 16-bit incrementer of the address unit.

### 4.1 Branch conditions

| Code | Mnemonic (aliases)    | Taken when                                  |
| ---- | --------------------- | ------------------------------------------- |
| 0    | `JMP`                 | always                                      |
| 1    | `JEQ` (`JZ`)          | `Z = 1`                                     |
| 2    | `JNE` (`JNZ`)         | `Z = 0`                                     |
| 3    | `JCS` (`JLTU`, `JC`)  | `C = 1` — unsigned less-than after `CMP`    |
| 4    | `JCC` (`JGEU`, `JNC`) | `C = 0` — unsigned greater-or-equal         |
| 5    | `JMI`                 | `N = 1`                                     |
| 6    | `JPL`                 | `N = 0`                                     |
| 7    | `JVS`                 | `V = 1`                                     |
| 8    | `JVC`                 | `V = 0`                                     |
| 9    | `JLT`                 | `N ≠ V` — signed less-than                  |
| 10   | `JGE`                 | `N = V` — signed greater-or-equal           |
| 11   | `JGT`                 | `Z = 0` and `N = V` — signed greater-than   |
| 12   | `JLE`                 | `Z = 1` or `N ≠ V` — signed less-or-equal   |
| 13   | `JGTU`                | `C = 0` and `Z = 0` — unsigned greater-than |
| 14   | `JLEU`                | `C = 1` or `Z = 1` — unsigned less-or-equal |

## 5. Instruction encoding

The first byte is always the opcode. Remaining bytes depend on the format:

| Format   | Bytes | Layout                                                                         |
| -------- | ----- | ------------------------------------------------------------------------------ |
| `N`      | 1     | `opcode`                                                                       |
| `RB`     | 2     | `opcode`, `aaaa bbbb` (register byte: field A high nibble, field B low nibble) |
| `RB+I8`  | 3     | `opcode`, register byte, 8-bit immediate or unsigned offset                    |
| `RB+I16` | 4     | `opcode`, register byte, 16-bit immediate/address (low byte first)             |
| `A16`    | 3     | `opcode`, 16-bit address (low byte first)                                      |

### 5.1 Addressing modes

| Mode                   | Syntax           | Example           | Effective address / value                             |
| ---------------------- | ---------------- | ----------------- | ----------------------------------------------------- |
| Register               | `Rn`, `Pn`, `SP` | `ADD R0, R1`      | register contents                                     |
| Immediate              | `#expr`          | `MOV R0, #10`     | the encoded constant                                  |
| Absolute               | `[expr]`         | `LD R0, [0x6000]` | the 16-bit address                                    |
| Register-indirect      | `[W]`            | `LD R0, [P1]`     | contents of the wide register                         |
| Base + offset          | `[W+expr]`       | `LD R0, [SP+3]`   | `W + offset`, offset unsigned 0–255, wraps mod 65 536 |
| Direct jump            | `expr`           | `JMP loop`        | the 16-bit address                                    |
| Register-indirect jump | `W`              | `CALL P2`         | contents of the wide register                         |

Register-indirect is base + offset with offset 0 (same encoding).

## 6. Exceptions and interrupts

### 6.1 Vector table

The vector table is 16 little-endian 16-bit handler addresses starting at `VBASE`.

| Vector | Name          | Kind                                              | Saved `PC`           |
| ------ | ------------- | ------------------------------------------------- | -------------------- |
| 0      | `RESET`       | reset only (read from `0x0000` at reset)          | —                    |
| 1      | `ILLEGAL`     | fault: undefined opcode or invalid encoding       | faulting instruction |
| 2      | `PRIVILEGE`   | fault: privileged instruction in user mode        | faulting instruction |
| 3      | `MEMORY`      | fault: protection violation, ROM write, bus error | faulting instruction |
| 4      | `SYSCALL`     | trap: `SYS` instruction                           | next instruction     |
| 5      | `BREAK`       | trap: `BRK` instruction                           | next instruction     |
| 6–7    | —             | reserved                                          | —                    |
| 8–15   | `IRQ0`–`IRQ7` | maskable hardware interrupt lines 0–7             | next instruction     |

A vector entry containing `0xFFFF` (the erased-ROM value) means _no handler
installed_. Taking such a vector stops the CPU in the **machine-check** state
with the reason `unhandled exception`. Only a reset leaves machine check.

### 6.2 When exceptions are recognised

- **Faults** are detected by the micro-operation that performs the illegal
  action. The instruction is abandoned before any later micro-operation runs.
  All architectural register writes in VC-8 micro-programs happen _after_ the
  instruction's last memory access, so a faulting instruction leaves registers,
  `SP` and flags unchanged and `PC` is restored to the instruction's first byte:
  faults are **precise** and restartable.
- **Traps** (`SYS`, `BRK`) complete their instruction, then enter the handler.
- **Interrupts** are sampled only at instruction boundaries.

Priority at an instruction boundary: (1) a pending fault or trap, (2) the
lowest-numbered pending interrupt line that is enabled in the interrupt
controller's `MASK` register, provided `PSW.I = 1`.

### 6.3 Cause codes (`CAUSE` register)

| Code       | Name                     |
| ---------- | ------------------------ |
| `0x01`     | `ILLEGAL_INSTRUCTION`    |
| `0x02`     | `PRIVILEGED_INSTRUCTION` |
| `0x03`     | `READ_VIOLATION`         |
| `0x04`     | `WRITE_VIOLATION`        |
| `0x05`     | `FETCH_VIOLATION`        |
| `0x06`     | `ROM_WRITE`              |
| `0x07`     | `BUS_ERROR`              |
| `0x10`     | `SYSCALL`                |
| `0x11`     | `BREAKPOINT`             |
| `0x20 + n` | `IRQ n`                  |

For memory faults `FADDR` holds the offending address.

### 6.4 Exception entry (performed by hardware)

Exception entry is a 12-cycle micro-sequence (listed in `isa-reference.md`):

1. `TMP ← PSW`; `CAUSE ← code`; (`FADDR ← addr` for memory faults);
   `PSW.S ← 1`; `PSW.I ← 0`. Setting `S` selects `KSP`, so an exception from
   user mode switches to the kernel stack.
2. Push `PC` high byte, then `PC` low byte, then `TMP` (the old PSW) onto the
   supervisor stack (6 micro-operations, each push = address then write).
3. `SP ← new stack top`.
4. Read the 16-bit handler address from `VBASE + 2 × vector` (address, read
   low byte, increment, read high byte).
5. `PC ← handler`.

The resulting **exception frame** on the supervisor stack is:

| Address  | Contents             |
| -------- | -------------------- |
| `SP + 0` | saved `PSW`          |
| `SP + 1` | saved `PC` low byte  |
| `SP + 2` | saved `PC` high byte |

The hardware saves **only** `PC` and `PSW` (and switches stacks). The handler
must save any general registers it uses, and the kernel must save `USP` itself
if it will run another process. `CAUSE` and `FADDR` are _not_ part of the
frame: a later exception overwrites them, so a handler that needs them must
read them before it can cause or permit another exception. `FADDR` is written
only by memory faults; other exceptions leave it unchanged.

If any access during exception entry faults (for example, a kernel stack that
points into ROM), the CPU stops in **machine-check** state with the reason
`double fault`.

### 6.5 Return from exception — `RTI`

`RTI` (privileged) pops `PSW`, then `PC` low, then `PC` high from the
supervisor stack, updates `KSP`, then loads `PSW` and `PC`. If the restored `S`
is 0 the CPU continues in user mode on `USP`. If the restored `I` is 1 a pending
interrupt can be taken immediately after `RTI`.

### 6.6 Masking and nesting

Exception entry clears `I`, so handlers start with interrupts masked. A handler
may execute `STI` to permit nesting; the reference kernel does not, so in the
reference system interrupts never nest. Faults and traps are not maskable: a
fault inside a handler enters its vector immediately (nesting on the same
supervisor stack).

The interrupt controller also has a per-line `MASK` register (§8.2). A line
must be enabled there _and_ `PSW.I` must be 1 for the interrupt to be taken.

### 6.7 Halting — `HLT`

`HLT` (privileged) completes and puts the CPU into the _waiting_ state. While
waiting, each clock cycle is an idle micro-operation (devices keep running).
The CPU leaves the waiting state as soon as any interrupt line is pending
**and** enabled in `MASK` — regardless of `PSW.I`. If `PSW.I = 1` the interrupt
is then taken; if `PSW.I = 0` execution simply resumes after the `HLT` and
software can poll the controller. With `MASK = 0` the CPU waits forever
(the debugger reports this as _halted_).

## 7. Micro-operation and timing model

Every instruction is executed as a fixed micro-program of register-transfer
micro-operations; each micro-operation takes exactly one clock cycle and
advances every device by one cycle. The micro-programs are listed per opcode in
`isa-reference.md`. Common stages:

| Micro-operation          | Register transfer                                                        |
| ------------------------ | ------------------------------------------------------------------------ |
| `FETCH`                  | `MAR ← PC`; `IR ← M[MAR]`; `PC ← PC + 1`                                 |
| `DECODE`                 | control unit selects the micro-program for `IR` (illegal opcode → fault) |
| `FETCH REG`              | `OPR ← M[PC]`; `PC ← PC + 1`; register fields validated                  |
| `FETCH IMM LO/HI`        | `IMM.lo/hi ← M[PC]`; `PC ← PC + 1`                                       |
| `READ REGS`              | ALU inputs `A`, `B` loaded from registers or `IMM`                       |
| `ALU`                    | `Y ← A op B`; new flags computed (not yet committed)                     |
| `WRITE BACK`             | destination register and/or flags committed                              |
| `ADDRESS`                | `MAR ← effective address` (16-bit address unit)                          |
| `MEM READ` / `MEM WRITE` | `MDR ← M[MAR]` / `M[MAR] ← MDR`, protection checked                      |

The instruction-step command executes exactly the same micro-operations as
repeated micro-steps; there is one execution engine.

### 7.1 Clock and determinism

The simulated clock is the only notion of time. Devices advance per cycle, the
timer counts cycles, and storage latency is a fixed number of cycles. Host
wall-clock time only decides _how many_ cycles are executed per animation
frame; it never changes results. Given the same initial state and the same
external inputs injected at the same cycles, execution is bit-for-bit
reproducible.

## 8. Devices

All device registers are 8 bits. Interrupt request lines are level-sensitive:
a line stays asserted until software acknowledges the condition at the device.

| Block    | Device                 | IRQ line |
| -------- | ---------------------- | -------- |
| `0xF000` | System control         | —        |
| `0xF010` | Interrupt controller   | —        |
| `0xF020` | Programmable timer     | 0        |
| `0xF030` | Terminal (text output) | —        |
| `0xF040` | Keyboard (input queue) | 1        |
| `0xF050` | LEDs / GPIO            | —        |
| `0xF060` | Block storage          | 2        |

### 8.1 System control — `0xF000`

| Addr            | Name        | Access | Description                                                                                                                             |
| --------------- | ----------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `0xF000`        | `ID`        | R      | `0x56` (`'V'`)                                                                                                                          |
| `0xF001`        | `VERSION`   | R      | `0x10` (spec 1.0)                                                                                                                       |
| `0xF002`        | `POWER`     | W      | writing `0xA5` powers the machine off                                                                                                   |
| `0xF004–0xF007` | `CYCLES0–3` | R      | 32-bit cycle counter, little-endian; reading `CYCLES0` latches all four bytes and returns the low byte; the others return latched bytes |

### 8.2 Interrupt controller — `0xF010`

| Addr     | Name      | Access | Description                                         |
| -------- | --------- | ------ | --------------------------------------------------- |
| `0xF010` | `PENDING` | R      | bit _n_ = line _n_ currently asserted by its device |
| `0xF011` | `MASK`    | R/W    | bit _n_ = line _n_ may interrupt the CPU (reset 0)  |

Arbitration: the lowest-numbered pending, enabled line wins.

### 8.3 Timer — `0xF020`

| Addr     | Name        | Access | Description                                                              |
| -------- | ----------- | ------ | ------------------------------------------------------------------------ |
| `0xF020` | `CTRL`      | R/W    | bit0 `EN` count, bit1 `IE` interrupt enable, bit2 `PERIODIC` auto-reload |
| `0xF021` | `STATUS`    | R/W1C  | bit0 `EXPIRED`; write 1 to acknowledge                                   |
| `0xF022` | `RELOAD_LO` | R/W    | reload value low byte                                                    |
| `0xF023` | `RELOAD_HI` | R/W    | reload value high byte                                                   |
| `0xF024` | `COUNT_LO`  | R      | current count low byte                                                   |
| `0xF025` | `COUNT_HI`  | R      | current count high byte                                                  |

When `EN` goes from 0 to 1, `COUNT ← RELOAD` (a reload of 0 means 65 536).
While `EN = 1`, `COUNT` decrements once per cycle, at the end of the cycle;
the cycle containing the enabling `CTRL` write counts as the first tick, so the
timer expires at the end of the `RELOAD`-th cycle starting with that one. When it reaches 0:
`EXPIRED ← 1`; if `PERIODIC`, `COUNT ← RELOAD`, otherwise `EN ← 0`. IRQ line 0
is asserted while `EXPIRED = 1` and `IE = 1`.

### 8.4 Terminal — `0xF030`

| Addr     | Name     | Access | Description                             |
| -------- | -------- | ------ | --------------------------------------- |
| `0xF030` | `DATA`   | W      | write a byte to the display             |
| `0xF031` | `STATUS` | R      | bit0 `READY` (always 1 in this version) |
| `0xF032` | `CTRL`   | W      | write `0x01` to clear the screen        |

Bytes `0x20–0x7E` print; `0x0A` (LF) starts a new line; `0x0D` (CR) returns to
column 0; `0x08` (BS) moves left one column. Other bytes print as `·`. The
display holds 80 columns × 24 rows and scrolls; the host keeps a bounded
scroll-back history.

### 8.5 Keyboard — `0xF040`

| Addr     | Name     | Access | Description                                                        |
| -------- | -------- | ------ | ------------------------------------------------------------------ |
| `0xF040` | `DATA`   | R      | dequeue and return the oldest byte (0 if empty)                    |
| `0xF041` | `STATUS` | R/W    | bit0 `AVAIL` (queue not empty), bit1 `OVERFLOW` (write 1 to clear) |
| `0xF042` | `CTRL`   | R/W    | bit0 `IE` interrupt enable                                         |
| `0xF043` | `COUNT`  | R      | number of queued bytes                                             |

The queue holds 16 bytes; a byte arriving when full is dropped and sets
`OVERFLOW`. IRQ line 1 is asserted while `AVAIL = 1` and `IE = 1`. The host
injects bytes (from the user's keyboard) at the current simulated cycle.

### 8.6 LEDs / GPIO — `0xF050`

| Addr     | Name       | Access | Description                      |
| -------- | ---------- | ------ | -------------------------------- |
| `0xF050` | `LEDS`     | R/W    | 8 output LEDs, bit _n_ = LED _n_ |
| `0xF051` | `SWITCHES` | R      | 8 input switches set by the user |

### 8.7 Block storage — `0xF060`

Capacity: 256 blocks × 256 bytes = 64 KiB.

| Addr     | Name       | Access | Description                                                                           |
| -------- | ---------- | ------ | ------------------------------------------------------------------------------------- |
| `0xF060` | `CMD`      | W      | `0x01` READ block → buffer, `0x02` WRITE buffer → block, `0x03` rewind buffer pointer |
| `0xF061` | `STATUS`   | R/W    | bit0 `BUSY`, bit1 `DONE`, bit2 `ERROR`; any write clears `DONE` and `ERROR`           |
| `0xF062` | `BLOCK_LO` | R/W    | block number low byte                                                                 |
| `0xF063` | `BLOCK_HI` | R/W    | block number high byte                                                                |
| `0xF064` | `DATA`     | R/W    | buffer data port; each access auto-increments the buffer pointer (wraps at 256)       |
| `0xF065` | `ERRCODE`  | R      | 0 none, 1 bad block number, 2 bad command, 3 command while busy                       |
| `0xF066` | `CTRL`     | R/W    | bit0 `IE` completion-interrupt enable                                                 |
| `0xF067` | `BLOCKS`   | R      | capacity in blocks, low byte (`0x00` = 256)                                           |

Every accepted command rewinds the buffer pointer to 0. READ and WRITE latch
the block number at the moment the command is written and set `BUSY` for a
fixed 64 cycles; on completion `BUSY ← 0` and `DONE ← 1` with `ERRCODE = 0`,
or `ERROR ← 1` with an error code. IRQ line 2 is asserted while (`DONE` or
`ERROR`) and `IE = 1`. Data moves only through the `DATA` port — there is no
DMA, so the CPU itself copies every byte (programmed I/O).

While `BUSY = 1` the buffer belongs to the controller: `DATA` reads return
`0x00` and writes are ignored (the pointer does not move); a new command is
rejected and only sets `ERRCODE = 3` (the in-flight operation continues and
sets `ERRCODE` again when it completes). Writes to `BLOCK_LO`/`BLOCK_HI` are
accepted but only affect the next command.

## 9. Hardware/software boundary

| Implemented in TypeScript (simulated hardware and tools)          | Implemented as VC-8 machine code (software on the simulated computer) |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| Register file, ALU, address unit, control unit and micro-programs | Boot firmware (reset handler, storage probe, kernel loader)           |
| Memory, ROM write-protection, protection unit, bus decoding       | Kernel initialisation, vector table installation                      |
| Exception entry/return sequences, interrupt sampling              | Interrupt and exception handlers, context save/restore                |
| Interrupt controller, timer, terminal, keyboard, GPIO, storage    | Device drivers (terminal, keyboard, timer, storage, LEDs)             |
| Assembler, disassembler, disk-image builder (the "workstation")   | System-call dispatcher and services                                   |
| Debugger, tracing, visualisation (observe only)                   | Process table, round-robin scheduler, process launch                  |
|                                                                   | User programs                                                         |

The host never loads the kernel into RAM, never switches processes and never
emulates a system call. Its only ways of changing guest state are: building ROM
and disk images before power-on, the explicit debugger actions labelled as such
in the UI (memory/register edits, "program memory" loads for bare-metal
experiments), and device inputs (keys, switches).

## 10. Power and reset

- **Power on** clears RAM to `0x00`, programs the boot ROM image, inserts the
  storage medium, resets every device and the CPU, and sets the cycle counter
  to 0.
- **Reset** (the reset button) resets the CPU and all device registers but
  keeps RAM and the storage medium. It also restarts a machine that the guest
  powered off through `SYS_POWER`, and leaves the machine-check state.
- **Power off** by the guest (`SYS_POWER ← 0xA5`) stops the clock; nothing runs
  until reset or power on.
