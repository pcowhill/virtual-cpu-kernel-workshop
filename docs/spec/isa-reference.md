# VC-8 Instruction Set Reference

<!-- GENERATED FILE: do not edit. Source: src/core/isa/opcodes.ts + src/core/cpu/microcode.ts. Regenerate with `npm run docs:isa`. -->

Specification version 1.0. VC-8 is a custom educational ISA; see [architecture.md](architecture.md) for registers, memory map, flags and exception rules.

Encoding notation: `rrrr`/`ssss` = 8-bit register field (R0–R7), `wwww`/`bbbb` = wide register field (P0–P3 = 0–3, SP = 4), `cccc` = control register number, `0000` = must be zero. Multi-byte immediates are little-endian. Cycles = micro-operations = clock cycles.

80 instructions. Opcodes not listed raise an illegal-instruction fault.

## System and control

| Opcode | Syntax | Bytes | Encoding | Mode | Flags | Cycles | Priv | Operation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0x01` | `NOP` | 1 | `00000001` | implied | - | 2 | — | — |
| `0x02` | `HLT` | 1 | `00000010` | implied | - | 3 | yes | state ← waiting |
| `0x03` | `SYS` | 1 | `00000011` | implied | - | 3 | — | trap(SYSCALL); saved PC = next instruction |
| `0x04` | `BRK` | 1 | `00000100` | implied | - | 3 | — | trap(BREAKPOINT); saved PC = next instruction |
| `0x05` | `RTI` | 1 | `00000101` | stack | CZNV | 9 | yes | PSW ← pop; PC.lo ← pop; PC.hi ← pop |
| `0x07` | `CLI` | 1 | `00000111` | implied | - | 3 | yes | PSW.I ← 0 |
| `0x08` | `STI` | 1 | `00001000` | implied | - | 3 | yes | PSW.I ← 1 |
| `0x09` | `CLC` | 1 | `00001001` | implied | C | 3 | — | C ← 0 |
| `0x0A` | `SEC` | 1 | `00001010` | implied | C | 3 | — | C ← 1 |

## Control flow

| Opcode | Syntax | Bytes | Encoding | Mode | Flags | Cycles | Priv | Operation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0x06` | `RET` | 1 | `00000110` | stack | - | 7 | — | PC.lo ← pop; PC.hi ← pop |
| `0x60` | `JMP addr` | 3 | `01100000 lo8 hi8` | direct (absolute target) | - | 5 | — | PC ← addr16 |
| `0x61` | `JEQ addr (alias JZ)` | 3 | `01100001 lo8 hi8` | direct (absolute target) | - | 5 | — | if Z = 1: PC ← addr16 |
| `0x62` | `JNE addr (alias JNZ)` | 3 | `01100010 lo8 hi8` | direct (absolute target) | - | 5 | — | if Z = 0: PC ← addr16 |
| `0x63` | `JCS addr (alias JLTU, JC)` | 3 | `01100011 lo8 hi8` | direct (absolute target) | - | 5 | — | if C = 1 (unsigned <): PC ← addr16 |
| `0x64` | `JCC addr (alias JGEU, JNC)` | 3 | `01100100 lo8 hi8` | direct (absolute target) | - | 5 | — | if C = 0 (unsigned ≥): PC ← addr16 |
| `0x65` | `JMI addr` | 3 | `01100101 lo8 hi8` | direct (absolute target) | - | 5 | — | if N = 1: PC ← addr16 |
| `0x66` | `JPL addr` | 3 | `01100110 lo8 hi8` | direct (absolute target) | - | 5 | — | if N = 0: PC ← addr16 |
| `0x67` | `JVS addr` | 3 | `01100111 lo8 hi8` | direct (absolute target) | - | 5 | — | if V = 1: PC ← addr16 |
| `0x68` | `JVC addr` | 3 | `01101000 lo8 hi8` | direct (absolute target) | - | 5 | — | if V = 0: PC ← addr16 |
| `0x69` | `JLT addr` | 3 | `01101001 lo8 hi8` | direct (absolute target) | - | 5 | — | if N ≠ V (signed <): PC ← addr16 |
| `0x6A` | `JGE addr` | 3 | `01101010 lo8 hi8` | direct (absolute target) | - | 5 | — | if N = V (signed ≥): PC ← addr16 |
| `0x6B` | `JGT addr` | 3 | `01101011 lo8 hi8` | direct (absolute target) | - | 5 | — | if Z = 0 and N = V (signed >): PC ← addr16 |
| `0x6C` | `JLE addr` | 3 | `01101100 lo8 hi8` | direct (absolute target) | - | 5 | — | if Z = 1 or N ≠ V (signed ≤): PC ← addr16 |
| `0x6D` | `JGTU addr` | 3 | `01101101 lo8 hi8` | direct (absolute target) | - | 5 | — | if C = 0 and Z = 0 (unsigned >): PC ← addr16 |
| `0x6E` | `JLEU addr` | 3 | `01101110 lo8 hi8` | direct (absolute target) | - | 5 | — | if C = 1 or Z = 1 (unsigned ≤): PC ← addr16 |
| `0x70` | `JMP Pn|SP` | 2 | `01110000 wwww0000` | register-indirect target | - | 4 | — | PC ← Wa |
| `0x71` | `CALL addr` | 3 | `01110001 lo8 hi8` | direct (absolute target) | - | 9 | — | push PC.hi; push PC.lo; PC ← addr16 |
| `0x72` | `CALL Pn|SP` | 2 | `01110010 wwww0000` | register-indirect target | - | 8 | — | push PC.hi; push PC.lo; PC ← Wa |

## Data movement

| Opcode | Syntax | Bytes | Encoding | Mode | Flags | Cycles | Priv | Operation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0x10` | `MOV Rn, Rn` | 2 | `00010000 rrrrssss` | register | - | 4 | — | Ra ← Rb |
| `0x11` | `MOV Rn, #imm8` | 3 | `00010001 rrrr0000 imm8` | immediate | - | 5 | — | Ra ← imm8 |
| `0x12` | `LD Rn, [addr]` | 4 | `00010010 rrrr0000 lo8 hi8` | absolute | - | 8 | — | Ra ← M[addr16] |
| `0x13` | `LD Rn, [Pn+off]` | 3 | `00010011 rrrrbbbb offset8` | base + offset / register-indirect | - | 7 | — | Ra ← M[Wb + off8] |
| `0x14` | `ST [addr], Rn` | 4 | `00010100 rrrr0000 lo8 hi8` | absolute | - | 7 | — | M[addr16] ← Ra |
| `0x15` | `ST [Pn+off], Rn` | 3 | `00010101 rrrrbbbb offset8` | base + offset / register-indirect | - | 6 | — | M[Wb + off8] ← Ra |

## Stack

| Opcode | Syntax | Bytes | Encoding | Mode | Flags | Cycles | Priv | Operation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0x16` | `PUSH Rn` | 2 | `00010110 rrrr0000` | register | - | 6 | — | SP ← SP − 1; M[SP] ← Ra |
| `0x17` | `POP Rn` | 2 | `00010111 rrrr0000` | register | - | 6 | — | Ra ← M[SP]; SP ← SP + 1 |
| `0x1E` | `PUSHP Pn|SP` | 2 | `00011110 wwww0000` | register | - | 8 | — | SP ← SP − 1; M[SP] ← Wa.hi; SP ← SP − 1; M[SP] ← Wa.lo |
| `0x1F` | `POPP Pn|SP` | 2 | `00011111 wwww0000` | register | - | 8 | — | Wa.lo ← M[SP]; Wa.hi ← M[SP+1]; SP ← SP + 2 |

## 16-bit data movement

| Opcode | Syntax | Bytes | Encoding | Mode | Flags | Cycles | Priv | Operation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0x18` | `MOVP Pn|SP, Pn|SP` | 2 | `00011000 wwwwbbbb` | register | - | 4 | — | Wa ← Wb |
| `0x19` | `MOVP Pn|SP, #imm16` | 4 | `00011001 wwww0000 lo8 hi8` | immediate | - | 6 | — | Wa ← imm16 |
| `0x1A` | `LDW Pn|SP, [addr]` | 4 | `00011010 wwww0000 lo8 hi8` | absolute | - | 10 | — | Wa.lo ← M[addr]; Wa.hi ← M[addr+1] |
| `0x1B` | `LDW Pn|SP, [Pn+off]` | 3 | `00011011 wwwwbbbb offset8` | base + offset / register-indirect | - | 9 | — | Wa.lo ← M[Wb+off]; Wa.hi ← M[Wb+off+1] |
| `0x1C` | `STW [addr], Pn|SP` | 4 | `00011100 wwww0000 lo8 hi8` | absolute | - | 9 | — | M[addr] ← Wa.lo; M[addr+1] ← Wa.hi |
| `0x1D` | `STW [Pn+off], Pn|SP` | 3 | `00011101 wwwwbbbb offset8` | base + offset / register-indirect | - | 8 | — | M[Wb+off] ← Wa.lo; M[Wb+off+1] ← Wa.hi |

## Privileged control registers

| Opcode | Syntax | Bytes | Encoding | Mode | Flags | Cycles | Priv | Operation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0x20` | `MFC Pn|SP, CR` | 2 | `00100000 wwwwcccc` | register | - | 4 | yes | Wa ← CRb |
| `0x21` | `MTC CR, Pn|SP` | 2 | `00100001 ccccbbbb` | register | CZNV | 4 | yes | CRa ← Wb |

## 8-bit arithmetic and logic

| Opcode | Syntax | Bytes | Encoding | Mode | Flags | Cycles | Priv | Operation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0x30` | `ADD Rn, Rn` | 2 | `00110000 rrrrssss` | register | CZNV | 6 | — | Ra ← Ra + Rb |
| `0x31` | `ADC Rn, Rn` | 2 | `00110001 rrrrssss` | register | CZNV | 6 | — | Ra ← Ra + Rb + C |
| `0x32` | `SUB Rn, Rn` | 2 | `00110010 rrrrssss` | register | CZNV | 6 | — | Ra ← Ra − Rb |
| `0x33` | `SBC Rn, Rn` | 2 | `00110011 rrrrssss` | register | CZNV | 6 | — | Ra ← Ra − Rb − C |
| `0x34` | `CMP Rn, Rn` | 2 | `00110100 rrrrssss` | register | CZNV | 6 | — | flags ← Ra − Rb |
| `0x35` | `AND Rn, Rn` | 2 | `00110101 rrrrssss` | register | CZNV | 6 | — | Ra ← Ra & Rb |
| `0x36` | `OR Rn, Rn` | 2 | `00110110 rrrrssss` | register | CZNV | 6 | — | Ra ← Ra \| Rb |
| `0x37` | `XOR Rn, Rn` | 2 | `00110111 rrrrssss` | register | CZNV | 6 | — | Ra ← Ra ^ Rb |
| `0x38` | `ADD Rn, #imm8` | 3 | `00111000 rrrr0000 imm8` | immediate | CZNV | 7 | — | Ra ← Ra + imm8 |
| `0x39` | `ADC Rn, #imm8` | 3 | `00111001 rrrr0000 imm8` | immediate | CZNV | 7 | — | Ra ← Ra + imm8 + C |
| `0x3A` | `SUB Rn, #imm8` | 3 | `00111010 rrrr0000 imm8` | immediate | CZNV | 7 | — | Ra ← Ra − imm8 |
| `0x3B` | `SBC Rn, #imm8` | 3 | `00111011 rrrr0000 imm8` | immediate | CZNV | 7 | — | Ra ← Ra − imm8 − C |
| `0x3C` | `CMP Rn, #imm8` | 3 | `00111100 rrrr0000 imm8` | immediate | CZNV | 7 | — | flags ← Ra − imm8 |
| `0x3D` | `AND Rn, #imm8` | 3 | `00111101 rrrr0000 imm8` | immediate | CZNV | 7 | — | Ra ← Ra & imm8 |
| `0x3E` | `OR Rn, #imm8` | 3 | `00111110 rrrr0000 imm8` | immediate | CZNV | 7 | — | Ra ← Ra \| imm8 |
| `0x3F` | `XOR Rn, #imm8` | 3 | `00111111 rrrr0000 imm8` | immediate | CZNV | 7 | — | Ra ← Ra ^ imm8 |

## 8-bit unary and shifts

| Opcode | Syntax | Bytes | Encoding | Mode | Flags | Cycles | Priv | Operation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0x40` | `INC Rn` | 2 | `01000000 rrrr0000` | register | ZNV | 6 | — | Ra ← Ra + 1 |
| `0x41` | `DEC Rn` | 2 | `01000001 rrrr0000` | register | ZNV | 6 | — | Ra ← Ra − 1 |
| `0x42` | `NOT Rn` | 2 | `01000010 rrrr0000` | register | CZNV | 6 | — | Ra ← ~Ra |
| `0x43` | `NEG Rn` | 2 | `01000011 rrrr0000` | register | CZNV | 6 | — | Ra ← 0 − Ra |
| `0x44` | `SHL Rn` | 2 | `01000100 rrrr0000` | register | CZNV | 6 | — | C ← Ra[7]; Ra ← Ra << 1 |
| `0x45` | `SHR Rn` | 2 | `01000101 rrrr0000` | register | CZNV | 6 | — | C ← Ra[0]; Ra ← Ra >> 1 |
| `0x46` | `SAR Rn` | 2 | `01000110 rrrr0000` | register | CZNV | 6 | — | C ← Ra[0]; Ra ← (Ra >> 1) \| Ra[7] |
| `0x47` | `ROL Rn` | 2 | `01000111 rrrr0000` | register | CZNV | 6 | — | {C, Ra} ← {Ra, C} (9-bit rotate) |
| `0x48` | `ROR Rn` | 2 | `01001000 rrrr0000` | register | CZNV | 6 | — | {Ra, C} ← {C, Ra} (9-bit rotate) |
| `0x49` | `TST Rn` | 2 | `01001001 rrrr0000` | register | CZNV | 6 | — | flags ← Ra |

## 16-bit arithmetic

| Opcode | Syntax | Bytes | Encoding | Mode | Flags | Cycles | Priv | Operation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0x50` | `INCP Pn|SP` | 2 | `01010000 wwww0000` | register | Z | 5 | — | Wa ← Wa + 1 |
| `0x51` | `DECP Pn|SP` | 2 | `01010001 wwww0000` | register | Z | 5 | — | Wa ← Wa − 1 |
| `0x52` | `ADDP Pn|SP, Pn|SP` | 2 | `01010010 wwwwbbbb` | register | CZNV | 8 | — | Wa ← Wa + Wb |
| `0x53` | `ADDP Pn|SP, #imm16` | 4 | `01010011 wwww0000 lo8 hi8` | immediate | CZNV | 10 | — | Wa ← Wa + imm16 |
| `0x54` | `ADDP Pn|SP, Rn` | 2 | `01010100 wwwwssss` | register | CZNV | 8 | — | Wa ← Wa + zext(Rb) |
| `0x55` | `SUBP Pn|SP, Pn|SP` | 2 | `01010101 wwwwbbbb` | register | CZNV | 8 | — | Wa ← Wa − Wb |
| `0x56` | `CMPP Pn|SP, Pn|SP` | 2 | `01010110 wwwwbbbb` | register | CZNV | 8 | — | flags ← Wa − Wb |
| `0x57` | `CMPP Pn|SP, #imm16` | 4 | `01010111 wwww0000 lo8 hi8` | immediate | CZNV | 10 | — | flags ← Wa − imm16 |

## Micro-programs

Each line is one clock cycle. `a`/`b` are the register-byte fields.

### `0x01` NOP — No operation

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege

### `0x02` HLT — Halt until an enabled interrupt line is pending

*Notes:* Wakes when (PENDING & MASK) ≠ 0 regardless of PSW.I. If PSW.I = 1 the interrupt is then taken; otherwise execution continues after HLT.

*Errors:* privilege fault (vector 2) in user mode; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. EXECUTE: enter waiting state (sleep until an enabled IRQ is pending)

### `0x03` SYS — System call (software trap, vector 4)

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. EXECUTE: raise SYSCALL trap (vector 4)

### `0x04` BRK — Breakpoint trap (vector 5)

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. EXECUTE: raise BREAKPOINT trap (vector 5)

### `0x05` RTI — Return from interrupt/exception

*Notes:* Restores the whole PSW, including S and I; returning with S = 0 switches to USP.

*Errors:* privilege fault (vector 2) in user mode; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. ADDRESS: MAR ← SP
4. MEM READ: MDR ← M[MAR]; TMP ← MDR
5. ADDRESS: MAR ← MAR + 1
6. MEM READ: MDR ← M[MAR]; T.lo ← MDR
7. ADDRESS: MAR ← MAR + 1
8. MEM READ: MDR ← M[MAR]; T.hi ← MDR
9. EXECUTE: SP ← MAR + 1; PSW ← TMP (may switch to user mode/USP); PC ← T

### `0x06` RET — Return from subroutine

*Errors:* memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. ADDRESS: MAR ← SP
4. MEM READ: MDR ← M[MAR]; T.lo ← MDR
5. ADDRESS: MAR ← MAR + 1
6. MEM READ: MDR ← M[MAR]; T.hi ← MDR
7. EXECUTE: SP ← MAR + 1; PC ← T

### `0x07` CLI — Disable maskable interrupts

*Errors:* privilege fault (vector 2) in user mode; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. EXECUTE: PSW.I ← 0

### `0x08` STI — Enable maskable interrupts

*Errors:* privilege fault (vector 2) in user mode; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. EXECUTE: PSW.I ← 1

### `0x09` CLC — Clear carry

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. EXECUTE: PSW.C ← 0

### `0x0A` SEC — Set carry

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. EXECUTE: PSW.C ← 1

### `0x10` MOV Rn, Rn — Copy register

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. EXECUTE: Ra ← Rb

### `0x11` MOV Rn, #imm8 — Load immediate byte

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM: IMM ← M[PC]; PC ← PC + 1
5. WRITE BACK: Ra ← IMM

### `0x12` LD Rn, [addr] — Load byte from absolute address

*Notes:* Memory fault if the access is not permitted.

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
5. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
6. ADDRESS: MAR ← IMM
7. MEM READ: MDR ← M[MAR]
8. WRITE BACK: Ra ← MDR

### `0x13` LD Rn, [Pn+off] — Load byte from base register + offset

*Notes:* Offset is unsigned (0–255); the address wraps modulo 65 536.

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM: IMM ← M[PC]; PC ← PC + 1
5. ADDRESS: MAR ← Wb + IMM (address unit)
6. MEM READ: MDR ← M[MAR]
7. WRITE BACK: Ra ← MDR

### `0x14` ST [addr], Rn — Store byte to absolute address

*Notes:* Memory fault if the access is not permitted (ROM is never writable).

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
5. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
6. ADDRESS: MAR ← IMM; MDR ← Ra
7. MEM WRITE: M[MAR] ← MDR

### `0x15` ST [Pn+off], Rn — Store byte to base register + offset

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM: IMM ← M[PC]; PC ← PC + 1
5. ADDRESS: MAR ← Wb + IMM (address unit); MDR ← Ra
6. MEM WRITE: M[MAR] ← MDR

### `0x16` PUSH Rn — Push byte

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. ADDRESS: MAR ← SP − 1; MDR ← Ra
5. MEM WRITE: M[MAR] ← MDR
6. UPDATE SP: SP ← MAR

### `0x17` POP Rn — Pop byte

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. ADDRESS: MAR ← SP
5. MEM READ: MDR ← M[MAR]
6. WRITE BACK: SP ← MAR + 1; Ra ← MDR

### `0x18` MOVP Pn|SP, Pn|SP — Copy 16-bit register (pairs or SP)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. EXECUTE: Wa ← Wb

### `0x19` MOVP Pn|SP, #imm16 — Load 16-bit immediate

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
5. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
6. WRITE BACK: Wa ← IMM

### `0x1A` LDW Pn|SP, [addr] — Load 16-bit word (little-endian) from absolute address

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
5. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
6. ADDRESS: MAR ← IMM
7. MEM READ: MDR ← M[MAR]; T.lo ← MDR
8. ADDRESS: MAR ← MAR + 1
9. MEM READ: MDR ← M[MAR]; T.hi ← MDR
10. WRITE BACK: Wa ← T

### `0x1B` LDW Pn|SP, [Pn+off] — Load 16-bit word from base register + offset

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM: IMM ← M[PC]; PC ← PC + 1
5. ADDRESS: MAR ← Wb + IMM (address unit)
6. MEM READ: MDR ← M[MAR]; T.lo ← MDR
7. ADDRESS: MAR ← MAR + 1
8. MEM READ: MDR ← M[MAR]; T.hi ← MDR
9. WRITE BACK: Wa ← T

### `0x1C` STW [addr], Pn|SP — Store 16-bit word to absolute address

*Notes:* If the second byte faults, the first byte has already been written.

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
5. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
6. ADDRESS: MAR ← IMM; T ← Wa; MDR ← T.lo
7. MEM WRITE: M[MAR] ← MDR
8. ADDRESS: MAR ← MAR + 1; MDR ← T.hi
9. MEM WRITE: M[MAR] ← MDR

### `0x1D` STW [Pn+off], Pn|SP — Store 16-bit word to base register + offset

*Notes:* If the second byte faults, the first byte has already been written.

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM: IMM ← M[PC]; PC ← PC + 1
5. ADDRESS: MAR ← Wb + IMM (address unit); T ← Wa; MDR ← T.lo
6. MEM WRITE: M[MAR] ← MDR
7. ADDRESS: MAR ← MAR + 1; MDR ← T.hi
8. MEM WRITE: M[MAR] ← MDR

### `0x1E` PUSHP Pn|SP — Push 16-bit register (high byte first)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. ADDRESS: T ← Wa; MAR ← SP − 1; MDR ← T.hi
5. MEM WRITE: M[MAR] ← MDR
6. ADDRESS: MAR ← MAR − 1; MDR ← T.lo
7. MEM WRITE: M[MAR] ← MDR
8. UPDATE SP: SP ← MAR

### `0x1F` POPP Pn|SP — Pop 16-bit register

*Notes:* POPP SP leaves SP equal to the popped value.

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. ADDRESS: MAR ← SP
5. MEM READ: MDR ← M[MAR]; T.lo ← MDR
6. ADDRESS: MAR ← MAR + 1
7. MEM READ: MDR ← M[MAR]; T.hi ← MDR
8. WRITE BACK: SP ← MAR + 1; Wa ← T

### `0x20` MFC Pn|SP, CR — Move from control register

*Errors:* privilege fault (vector 2) in user mode; illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. EXECUTE: Wa ← CRb

### `0x21` MTC CR, Pn|SP — Move to control register

*Notes:* Writes to CAUSE and FADDR are ignored. Writing PSW takes effect immediately (flags only change when the target is PSW).

*Errors:* privilege fault (vector 2) in user mode; illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. EXECUTE: CRa ← Wb

### `0x30` ADD Rn, Rn — Add

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra; B ← Rb
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x31` ADC Rn, Rn — Add with carry

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra; B ← Rb
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x32` SUB Rn, Rn — Subtract (C = borrow)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra; B ← Rb
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x33` SBC Rn, Rn — Subtract with borrow

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra; B ← Rb
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x34` CMP Rn, Rn — Compare (subtract, discard result)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra; B ← Rb
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x35` AND Rn, Rn — Bitwise AND

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra; B ← Rb
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x36` OR Rn, Rn — Bitwise OR

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra; B ← Rb
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x37` XOR Rn, Rn — Bitwise XOR

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra; B ← Rb
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x38` ADD Rn, #imm8 — Add (immediate)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM: IMM ← M[PC]; PC ← PC + 1
5. READ REGS: A ← Ra; B ← IMM
6. ALU: Y ← A op B; FLAGS' ← computed flags
7. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x39` ADC Rn, #imm8 — Add with carry (immediate)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM: IMM ← M[PC]; PC ← PC + 1
5. READ REGS: A ← Ra; B ← IMM
6. ALU: Y ← A op B; FLAGS' ← computed flags
7. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x3A` SUB Rn, #imm8 — Subtract (C = borrow) (immediate)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM: IMM ← M[PC]; PC ← PC + 1
5. READ REGS: A ← Ra; B ← IMM
6. ALU: Y ← A op B; FLAGS' ← computed flags
7. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x3B` SBC Rn, #imm8 — Subtract with borrow (immediate)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM: IMM ← M[PC]; PC ← PC + 1
5. READ REGS: A ← Ra; B ← IMM
6. ALU: Y ← A op B; FLAGS' ← computed flags
7. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x3C` CMP Rn, #imm8 — Compare (subtract, discard result) (immediate)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM: IMM ← M[PC]; PC ← PC + 1
5. READ REGS: A ← Ra; B ← IMM
6. ALU: Y ← A op B; FLAGS' ← computed flags
7. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x3D` AND Rn, #imm8 — Bitwise AND (immediate)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM: IMM ← M[PC]; PC ← PC + 1
5. READ REGS: A ← Ra; B ← IMM
6. ALU: Y ← A op B; FLAGS' ← computed flags
7. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x3E` OR Rn, #imm8 — Bitwise OR (immediate)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM: IMM ← M[PC]; PC ← PC + 1
5. READ REGS: A ← Ra; B ← IMM
6. ALU: Y ← A op B; FLAGS' ← computed flags
7. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x3F` XOR Rn, #imm8 — Bitwise XOR (immediate)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM: IMM ← M[PC]; PC ← PC + 1
5. READ REGS: A ← Ra; B ← IMM
6. ALU: Y ← A op B; FLAGS' ← computed flags
7. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x40` INC Rn — Increment

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x41` DEC Rn — Decrement

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x42` NOT Rn — Bitwise NOT (one's complement)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x43` NEG Rn — Negate (two's complement)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x44` SHL Rn — Shift left

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x45` SHR Rn — Logical shift right

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x46` SAR Rn — Arithmetic shift right

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x47` ROL Rn — Rotate left through carry

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x48` ROR Rn — Rotate right through carry

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x49` TST Rn — Test register (set Z, N)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Ra
5. ALU: Y ← A op B; FLAGS' ← computed flags
6. WRITE BACK: Ra ← Y (unless CMP/TST); PSW flags ← FLAGS'

### `0x50` INCP Pn|SP — Increment 16-bit register

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. EXECUTE: T ← Wa + 1 (incrementer)
5. WRITE BACK: Wa ← T; Z ← (T = 0)

### `0x51` DECP Pn|SP — Decrement 16-bit register

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. EXECUTE: T ← Wa − 1 (incrementer)
5. WRITE BACK: Wa ← T; Z ← (T = 0)

### `0x52` ADDP Pn|SP, Pn|SP — 16-bit add

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Wa.lo; B ← Wb.lo
5. ALU: Y ← A ± B (low byte); Cint ← carry/borrow
6. READ REGS: T.lo ← Y; A ← Wa.hi; B ← Wb.hi
7. ALU: Y ← A ± B ± Cint (high byte); FLAGS' ← 16-bit flags
8. WRITE BACK: Wa ← {Y, T.lo} (unless CMPP); PSW flags ← FLAGS'

### `0x53` ADDP Pn|SP, #imm16 — 16-bit add immediate

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
5. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
6. READ REGS: A ← Wa.lo; B ← IMM.lo
7. ALU: Y ← A ± B (low byte); Cint ← carry/borrow
8. READ REGS: T.lo ← Y; A ← Wa.hi; B ← IMM.hi
9. ALU: Y ← A ± B ± Cint (high byte); FLAGS' ← 16-bit flags
10. WRITE BACK: Wa ← {Y, T.lo} (unless CMPP); PSW flags ← FLAGS'

### `0x54` ADDP Pn|SP, Rn — Add zero-extended byte register to 16-bit register

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Wa.lo; B ← Rb
5. ALU: Y ← A ± B (low byte); Cint ← carry/borrow
6. READ REGS: T.lo ← Y; A ← Wa.hi; B ← 0
7. ALU: Y ← A ± B ± Cint (high byte); FLAGS' ← 16-bit flags
8. WRITE BACK: Wa ← {Y, T.lo} (unless CMPP); PSW flags ← FLAGS'

### `0x55` SUBP Pn|SP, Pn|SP — 16-bit subtract (C = borrow)

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Wa.lo; B ← Wb.lo
5. ALU: Y ← A ± B (low byte); Cint ← carry/borrow
6. READ REGS: T.lo ← Y; A ← Wa.hi; B ← Wb.hi
7. ALU: Y ← A ± B ± Cint (high byte); FLAGS' ← 16-bit flags
8. WRITE BACK: Wa ← {Y, T.lo} (unless CMPP); PSW flags ← FLAGS'

### `0x56` CMPP Pn|SP, Pn|SP — 16-bit compare

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. READ REGS: A ← Wa.lo; B ← Wb.lo
5. ALU: Y ← A ± B (low byte); Cint ← carry/borrow
6. READ REGS: T.lo ← Y; A ← Wa.hi; B ← Wb.hi
7. ALU: Y ← A ± B ± Cint (high byte); FLAGS' ← 16-bit flags
8. WRITE BACK: Wa ← {Y, T.lo} (unless CMPP); PSW flags ← FLAGS'

### `0x57` CMPP Pn|SP, #imm16 — 16-bit compare with immediate

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
5. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
6. READ REGS: A ← Wa.lo; B ← IMM.lo
7. ALU: Y ← A ± B (low byte); Cint ← carry/borrow
8. READ REGS: T.lo ← Y; A ← Wa.hi; B ← IMM.hi
9. ALU: Y ← A ± B ± Cint (high byte); FLAGS' ← 16-bit flags
10. WRITE BACK: Wa ← {Y, T.lo} (unless CMPP); PSW flags ← FLAGS'

### `0x60` JMP addr — Jump

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x61` JEQ addr — Jump if Z = 1

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x62` JNE addr — Jump if Z = 0

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x63` JCS addr — Jump if C = 1 (unsigned <)

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x64` JCC addr — Jump if C = 0 (unsigned ≥)

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x65` JMI addr — Jump if N = 1

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x66` JPL addr — Jump if N = 0

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x67` JVS addr — Jump if V = 1

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x68` JVC addr — Jump if V = 0

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x69` JLT addr — Jump if N ≠ V (signed <)

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x6A` JGE addr — Jump if N = V (signed ≥)

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x6B` JGT addr — Jump if Z = 0 and N = V (signed >)

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x6C` JLE addr — Jump if Z = 1 or N ≠ V (signed ≤)

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x6D` JGTU addr — Jump if C = 0 and Z = 0 (unsigned >)

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x6E` JLEU addr — Jump if C = 1 or Z = 1 (unsigned ≤)

*Errors:* memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. BRANCH: if condition(PSW): PC ← IMM

### `0x70` JMP Pn|SP — Jump to address in 16-bit register

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. EXECUTE: PC ← Wa

### `0x71` CALL addr — Call subroutine

*Errors:* memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH IMM LO: IMM.lo ← M[PC]; PC ← PC + 1
4. FETCH IMM HI: IMM.hi ← M[PC]; PC ← PC + 1
5. ADDRESS: MAR ← SP − 1; MDR ← PC.hi
6. MEM WRITE: M[MAR] ← MDR
7. ADDRESS: MAR ← MAR − 1; MDR ← PC.lo
8. MEM WRITE: M[MAR] ← MDR
9. EXECUTE: SP ← MAR; PC ← IMM

### `0x72` CALL Pn|SP — Call subroutine at address in 16-bit register

*Errors:* illegal-instruction fault (vector 1) for invalid register fields; memory fault (vector 3) if a data access is not permitted; memory fault (vector 3) if an instruction byte cannot be fetched.

1. FETCH: MAR ← PC; IR ← M[MAR]; PC ← PC + 1
2. DECODE: decode IR; select micro-program; check privilege
3. FETCH REG: OPR ← M[PC]; PC ← PC + 1; validate fields a, b
4. ADDRESS: T ← Wa; MAR ← SP − 1; MDR ← PC.hi
5. MEM WRITE: M[MAR] ← MDR
6. ADDRESS: MAR ← MAR − 1; MDR ← PC.lo
7. MEM WRITE: M[MAR] ← MDR
8. EXECUTE: SP ← MAR; PC ← T

## Hardware sequences

### Reset

1. RESET: MAR ← 0x0000 (reset vector)
2. MEM READ: MDR ← M[MAR]; T.lo ← MDR
3. ADDRESS: MAR ← MAR + 1
4. MEM READ: MDR ← M[MAR]; T.hi ← MDR
5. RESET: PC ← T (reset vector)

### Exception / interrupt entry

1. EXC ENTER: TMP ← PSW; CAUSE ← code; PSW.S ← 1 (select KSP); PSW.I ← 0
2. ADDRESS: MAR ← SP − 1; MDR ← PC.hi
3. MEM WRITE: M[MAR] ← MDR
4. ADDRESS: MAR ← MAR − 1; MDR ← PC.lo
5. MEM WRITE: M[MAR] ← MDR
6. ADDRESS: MAR ← MAR − 1; MDR ← TMP (old PSW)
7. MEM WRITE: M[MAR] ← MDR
8. ADDRESS: SP ← MAR; MAR ← VBASE + 2 × vector
9. MEM READ: MDR ← M[MAR]; T.lo ← MDR
10. ADDRESS: MAR ← MAR + 1
11. MEM READ: MDR ← M[MAR]; T.hi ← MDR
12. EXC JUMP: PC ← T (handler address)
