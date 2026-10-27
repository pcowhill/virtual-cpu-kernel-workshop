# VC-8 assembly language

The workshop assembler (`src/core/asm/assembler.ts`) turns VC-8 assembly into machine code. It is used for every
image in the workbench: the boot ROM, the kernel, user programs and the bare-metal examples. Instruction syntax,
encodings and cycle counts are listed in the generated [instruction set reference](isa-reference.md); this page
describes the language around them.

> VC-8 is a custom educational instruction set. Its assembly language follows common conventions but is not
> compatible with any real assembler or processor.

## Lines

```asm
label:  MNEMONIC operand, operand     ; comment
NAME    = expression                  ; constant
        .directive operands
```

- A `;` starts a comment (except inside a string or character literal).
- Mnemonics, register names and directives are case-insensitive. Labels and constants are case-sensitive.
- A line may carry several labels (`a: b: NOP`).

## Symbols

- **Labels** (`name:`) take the address of the next byte emitted.
- **Constants**: `NAME = expr` or `NAME .equ expr` or `.equ NAME, expr`. A constant may be used before it is
  defined as long as the instruction's size does not depend on it (sizes depend only on operand syntax).
- **Local labels** start with a dot (`.loop:`) and belong to the preceding global label: `.loop` after `copy:` is
  the symbol `copy.loop`. References to `.loop` inside the same scope resolve to it.
- Names: letters, digits, `_`, `.`, `@`; they may not start with a digit. Register names (`R0`–`R7`, `P0`–`P3`,
  `SP`) and control-register names (`PSW`, `USP`, `VBASE`, `UBASE`, `ULIMIT`, `CAUSE`, `FADDR`, `KSCRATCH`) are
  reserved.

## Expressions

Numbers: decimal `42`, hexadecimal `0x2A`, binary `0b101010`; `_` may separate digits (`0x00_FF`). Characters:
`'A'`, with escapes `\n \r \t \0 \\ \' \" \a \b \e \xNN`.

Operators, lowest to highest precedence:

| Precedence | Operators         |
| ---------- | ----------------- |
| 1          | `\|`              |
| 2          | `^`               |
| 3          | `&`               |
| 4          | `<<` `>>`         |
| 5          | `+` `-`           |
| 6          | `*` `/` `%`       |
| 7          | unary `-` `~` `+` |

Plus `(…)`, `$` (the address of the current statement), `lo(x)` and `hi(x)` (low and high byte of a 16-bit
value). Arithmetic is on integers; values are range-checked where they are used (an 8-bit immediate must be in
−128…255, a 16-bit one in −32768…65535).

## Operands

| Syntax                   | Meaning                                | Example                       |
| ------------------------ | -------------------------------------- | ----------------------------- |
| `Rn`                     | 8-bit register                         | `ADD R0, R1`                  |
| `Pn`, `SP`               | register pair / stack pointer (16-bit) | `INCP P1`, `MOVP SP, #0x3000` |
| `#expr`                  | immediate                              | `MOV R0, #'A'`                |
| `[expr]`                 | absolute address                       | `ST [0xF030], R0`             |
| `[Pn]`, `[SP]`           | register indirect                      | `LD R0, [P1]`                 |
| `[Pn+expr]`, `[SP+expr]` | base + displacement                    | `LD R0, [SP+3]`               |
| `expr`                   | branch/jump/call target                | `JNE loop`                    |
| control register         | `MFC`/`MTC` operand                    | `MTC UBASE, P0`               |

Pairs are named by their first register's role: `P0 = R0:R1` with R0 the **high** byte.

## Directives

| Directive                  | Effect                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `.org expr`                | Continue emitting at address `expr`.                                                                                 |
| `.byte e, …` / `.db`       | Emit bytes (each −128…255). Strings are allowed: `.byte "AB", 0`.                                                    |
| `.word e, …` / `.dw`       | Emit 16-bit little-endian words.                                                                                     |
| `.ascii "…"`               | Emit the characters of a string.                                                                                     |
| `.asciz "…"` / `.string`   | Emit a string followed by a zero byte.                                                                               |
| `.space n [, v]` / `.fill` | Emit `n` bytes of value `v` (default 0).                                                                             |
| `.align n`                 | Advance to the next multiple of `n`.                                                                                 |
| `.equ NAME, e`             | Define a constant.                                                                                                   |
| `.include "file"`          | Assemble another file in place. The path is tried as given, then relative to the including file, then in `include/`. |

Shipped include files:

- `include/vc8.inc`: device register addresses (`TERM_DATA`, `TIMER_CTRL`, …), bit masks, PSW bits.
- `include/syscalls.inc`: the system-call numbers and ABI used by user programs.

## Images and placement

- **Bare-metal programs** are assembled into a 64 KiB image; bytes in ROM (`0x0000–0x1FFF`) are programmed
  into the ROM chip, and bytes in RAM are preloaded at power-on (a debugger convenience; there is no OS). Bytes
  in the device region are refused. The reset vector at `0x0000` must point at the entry code.
- **User programs** for the operating system start with `.org PROC_BASE`. The build predefines `PROC_BASE` and
  `PROC_LIMIT` for the program's slot (each slot is 8 KiB at `0x6000 + slot × 0x2000`); emitting outside the
  slot is an error.
- The **kernel** is assembled for `0x2000–0x5FFF` and stored on the boot disk; the **firmware** must fit the
  ROM.

## Diagnostics

Errors carry the file, line and column and are shown in the Assembly editor. Typical messages: unknown
mnemonic, operand that does not fit the instruction, value out of range, undefined or duplicate symbol, include
cycle, bytes outside the allowed region. Building never touches the running machine; only **Build & load**
power-cycles it with the new images.

## Listing and source map

Each build produces a listing (address and bytes per source line) and a source map (address → file and line).
The editor uses them for line ↔ byte navigation, gutter breakpoints and the PC marker; the debugger's
disassembly uses them to show data regions as data.
