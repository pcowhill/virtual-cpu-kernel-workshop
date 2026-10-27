/**
 * The guided lessons. Every step's check reads the live machine; every
 * "Show me" solution is a sequence of ordinary workbench actions, and
 * tests/integration/lessons.test.ts proves each solution satisfies its check
 * on the real emulator (and that the checks do not pass before it).
 */
import type { ProgramSpec } from '../core/build/system';
import type { Lesson } from './engine';

const prog = (name: string, file = name): ProgramSpec => ({ name, path: `programs/${file}.asm` });
const DEFAULT_OS = [prog('alpha'), prog('digits'), prog('echo'), prog('blinker')];

export const LESSONS: Lesson[] = [
  {
    id: 'registers',
    number: 1,
    title: '8-bit registers and the 16-bit address space',
    summary: 'Eight 8-bit registers, register pairs for 16-bit addresses, and a 64 KiB address space.',
    objectives: [
      'Name the eight data registers and the four register pairs',
      'Explain why addresses need two registers on an 8-bit CPU',
      'Find ROM, RAM and device addresses in the memory map',
    ],
    explanation: `VC-8 computes with **8-bit** registers R0–R7: each holds 0–255. Memory addresses are **16 bits**
(0x0000–0xFFFF), so a pointer needs two registers. The CPU pairs them: **P0 = R0:R1**, P1 = R2:R3, P2 = R4:R5,
P3 = R6:R7 (the first register is the high byte). The address space is split into ROM (0x0000–0x1FFF), kernel
RAM, user RAM and device registers at 0xF000–0xFFFF.`,
    setup: { kind: 'bare', file: 'examples/first-program.asm' },
    lab: 'cpu',
    steps: [
      {
        title: 'Finish the reset',
        body: `The machine is powered on with *first-program* in ROM. The CPU starts with a reset sequence that loads PC
from the 16-bit **reset vector** at addresses 0x0000–0x0001. Press **Step** (<kbd>F10</kbd>) once.`,
        lab: 'cpu',
        check: { kind: 'pausedAt', at: 'start' },
        solution: [{ do: 'step', count: 1 }],
      },
      {
        title: 'Load two registers',
        body: `Step two more instructions: \`MOV R0, #0\` and \`MOV R1, #10\`. Watch the register panel: changed registers are
highlighted. Switch the panel between hex, decimal and binary.`,
        check: {
          kind: 'all',
          checks: [
            { kind: 'reg', reg: 'R0', value: 0 },
            { kind: 'reg', reg: 'R1', value: 10 },
            { kind: 'instructionsAtLeast', count: 2 },
          ],
        },
        solution: [{ do: 'step', count: 2 }],
      },
      {
        title: 'A 16-bit pointer in a register pair',
        body: `Run to the label \`print\` (in the editor, click the gutter of the \`print:\` line to set a breakpoint, then
**Run**). By then the program has stored its result at **0x2000** in RAM and loaded the address of its message into
**P1 = R2:R3** with \`MOVP\`. Open the Memory lab and go to \`0x2000\` and to \`message\`.`,
        lab: 'memory',
        check: {
          kind: 'all',
          checks: [
            { kind: 'pausedAt', at: 'print' },
            { kind: 'mem', at: 0x2000, value: 0x37 },
            { kind: 'reg', reg: 'R2', value: 0x01 },
            { kind: 'reg', reg: 'R3', value: 0x2c },
          ],
        },
        hint: 'P1 holds 0x012C, the address of `message` in ROM: R2 = 0x01 is the high byte, R3 = 0x2C the low byte.',
        solution: [{ do: 'runTo', at: 'print' }],
      },
    ],
    experiments: [
      'In the Memory lab, click the regions of the memory map. Which region holds the program, which the result?',
      'Use the hex view to find the bytes of the message text in ROM. Can the program write there? (Try lesson 18.)',
    ],
    observations: [
      'Only the registers an instruction writes are highlighted after a step.',
      'P1 shows the same value as R2 and R3 side by side: it is not a separate register.',
    ],
    examples: ['first-program', 'register-arithmetic'],
  },
  {
    id: 'fetch-decode-execute',
    number: 2,
    title: 'Fetch, decode and execute',
    summary: 'Every instruction is a short sequence of micro-operations, one per clock cycle.',
    objectives: [
      'Step a single clock cycle and identify the fetch micro-operations',
      'See which datapath units each micro-operation uses',
      'Relate instruction length to the number of fetch cycles',
    ],
    explanation: `The CPU does not execute an instruction in one go. It runs a **micro-program**: first it *fetches* the
opcode byte from memory at PC, then *decodes* it to pick the micro-program, then fetches operand bytes and *executes*.
Each micro-operation takes exactly one clock cycle and drives specific units: the address bus, the data bus, the ALU,
the register file. The Datapath lab highlights only the units the last micro-operation actually used.`,
    setup: { kind: 'bare', file: 'examples/first-program.asm' },
    lab: 'datapath',
    steps: [
      {
        title: 'Complete the reset sequence',
        body: 'Press **Step** once to complete the reset micro-sequence.',
        check: { kind: 'pausedAt', at: 'start' },
        solution: [{ do: 'step', count: 1 }],
      },
      {
        title: 'One clock cycle',
        body: `Press **µStep** (<kbd>Shift</kbd>+<kbd>F10</kbd>) once. The first micro-operation of every instruction puts PC
on the address bus and reads the opcode byte into IR. Look at the highlighted address bus and its value.`,
        lab: 'datapath',
        check: { kind: 'midInstruction' },
        solution: [{ do: 'micro', count: 1 }],
      },
      {
        title: 'Finish the instruction',
        body: `Keep pressing **µStep** until \`MOV R0, #0\` completes. It is three bytes long (opcode, register byte,
immediate), so you will see three memory reads before the register write. PC ends at 0x0103.`,
        check: { kind: 'pausedAt', at: 0x0103 },
        solution: [{ do: 'step', count: 1 }],
      },
      {
        title: 'The ALU at work',
        body: `Step \`MOV R1, #10\` and \`ADD R0, R1\` with µStep. During ADD the ALU is highlighted with its inputs and
result, and the flags it produced. R0 becomes 0x0A.`,
        check: {
          kind: 'all',
          checks: [
            { kind: 'reg', reg: 'R0', value: 0x0a },
            { kind: 'pausedAt', at: 0x0108 },
          ],
        },
        solution: [{ do: 'step', count: 2 }],
      },
    ],
    experiments: [
      'Compare the cycle counts of a 1-byte instruction (DEC R1) and a 3-byte one in the Reference lab.',
      'Which micro-operations of JNE run differently when the branch is taken?',
    ],
    observations: [
      'The cycle counter advances by exactly one per µStep.',
      'Units that a micro-operation does not use stay dark: nothing is animated for decoration.',
    ],
    examples: ['first-program'],
  },
  {
    id: 'flags',
    number: 3,
    title: 'Arithmetic operations and CPU flags',
    summary: 'Carry, zero, negative and overflow: what each flag means after ADD and SUB.',
    objectives: [
      'Predict C, Z, N and V after an addition or subtraction',
      'Distinguish unsigned overflow (carry) from signed overflow (V)',
      'Read the flags in the PSW',
    ],
    explanation: `Arithmetic instructions set four flags in the PSW. **Z**: the result is zero. **N**: bit 7 of the
result is 1 (negative if signed). **C**: unsigned overflow — a carry out of bit 7 on addition, a *borrow* on
subtraction. **V**: signed overflow — the result does not fit in −128…127. The program *overflow-carry* performs
four operations and copies the flags after each into RAM at 0x2000–0x2003.`,
    setup: { kind: 'bare', file: 'examples/overflow-carry.asm' },
    lab: 'cpu',
    steps: [
      {
        title: 'Reset',
        body: 'Step once to complete the reset.',
        check: { kind: 'pausedAt', at: 'start' },
        solution: [{ do: 'step', count: 1 }],
      },
      {
        title: '127 + 1',
        body: `Step five instructions: set up the stack, clear the result counter (two instructions), \`MOV R0, #0x7F\` and
\`ADD R0, #1\`. 0x7F + 1 = 0x80: as unsigned
numbers 127 + 1 = 128 is fine (no carry), but as signed numbers +127 + 1 cannot be +128 — so **V** is set, and
**N** is set because bit 7 is 1.`,
        check: {
          kind: 'all',
          checks: [
            { kind: 'reg', reg: 'R0', value: 0x80 },
            { kind: 'flag', flag: 'V', set: true },
            { kind: 'flag', flag: 'N', set: true },
            { kind: 'flag', flag: 'C', set: false },
          ],
        },
        solution: [{ do: 'step', count: 5 }],
      },
      {
        title: 'All four results',
        body: `Run the program to its end. The bytes at 0x2000–0x2003 hold the flags (bit 0 = C, 1 = Z, 2 = N, 3 = V) after
127+1, 255+1, −128−1 and 16−32. Check them in the Memory lab: 0x0C, 0x03, 0x08, 0x05.`,
        lab: 'memory',
        check: {
          kind: 'all',
          checks: [
            { kind: 'stopped', reason: 'halted' },
            { kind: 'mem', at: 0x2000, value: 0x0c },
            { kind: 'mem', at: 0x2001, value: 0x03 },
            { kind: 'mem', at: 0x2002, value: 0x08 },
            { kind: 'mem', at: 0x2003, value: 0x05 },
          ],
        },
        solution: [{ do: 'run', cycles: 5000 }],
      },
    ],
    experiments: [
      'Change `ADD R0, #1` after `MOV R0, #0xFF` into `ADD R0, #2`. Which flags change?',
      'Why does 16 − 32 set C? (VC-8 sets C when a subtraction borrows.)',
    ],
    observations: ['255 + 1 gives 0 with C and Z set, but V clear: −1 + 1 = 0 is fine for signed numbers.'],
    examples: ['overflow-carry', 'register-arithmetic'],
  },
  {
    id: 'branches',
    number: 4,
    title: 'Branches and conditional execution',
    summary: 'CMP sets flags; conditional jumps read them. Signed and unsigned comparisons differ.',
    objectives: [
      'Explain how CMP and a conditional jump work together',
      'Choose between signed (JGT/JLE) and unsigned (JGTU/JLEU) branches',
      'Change data and observe a different path through the program',
    ],
    explanation: `\`CMP a, b\` subtracts without storing the result: only the flags change. A conditional jump then tests
the flags. The same byte 200 is 200 as an unsigned number but −56 as a signed one, so \`JLEU\` and \`JLE\` can
decide differently. *conditional-loop* counts table entries greater than 50 both ways: R0 (unsigned), R1 (signed).`,
    setup: { kind: 'bare', file: 'examples/conditional-loop.asm' },
    lab: 'editor',
    steps: [
      {
        title: 'Run to the loop',
        body: 'Run to the label `next` (set a breakpoint in the editor gutter, or step). R4 counts the entries left: 5.',
        check: {
          kind: 'all',
          checks: [
            { kind: 'pausedAt', at: 'next' },
            { kind: 'reg', reg: 'R4', value: 5 },
          ],
        },
        solution: [
          { do: 'step', count: 1 },
          { do: 'runTo', at: 'next' },
        ],
      },
      {
        title: 'Two answers',
        body: `Run to the end. Of 10, 60, 200, 50, 99, three are above 50 as unsigned numbers (R0 = 3) but only two as signed
numbers (R1 = 2), because 200 is −56.`,
        check: {
          kind: 'all',
          checks: [
            { kind: 'stopped', reason: 'halted' },
            { kind: 'reg', reg: 'R0', value: 3 },
            { kind: 'reg', reg: 'R1', value: 2 },
          ],
        },
        solution: [{ do: 'run', cycles: 5000 }],
      },
      {
        title: 'Change the data',
        body: `In the editor, change the table entry \`50\` to \`51\` and press **Build & load**, then run. 51 > 50 both ways,
so both counts go up by one.`,
        lab: 'editor',
        check: {
          kind: 'all',
          checks: [
            { kind: 'sourceLoaded', file: 'examples/conditional-loop.asm', text: '200, 51, 99' },
            { kind: 'stopped', reason: 'halted' },
            { kind: 'reg', reg: 'R0', value: 4 },
            { kind: 'reg', reg: 'R1', value: 3 },
          ],
        },
        solution: [
          { do: 'edit', file: 'examples/conditional-loop.asm', find: '200, 50, 99', replace: '200, 51, 99' },
          { do: 'build' },
          { do: 'run', cycles: 5000 },
        ],
      },
    ],
    experiments: ['Add a negative number such as -100 to the table. Which count includes it?'],
    observations: ['A not-taken branch still costs cycles: it fetches its operand bytes.'],
    examples: ['conditional-loop'],
  },
  {
    id: 'memory',
    number: 5,
    title: 'Reading and writing memory',
    summary: 'Register-indirect loads and stores, pointers that advance, and watchpoints.',
    objectives: [
      'Use a register pair as a pointer with LD/ST [Pn]',
      'Set a write watchpoint and stop on the exact store',
      'Watch a buffer fill in the hex view',
    ],
    explanation: `\`LD R0, [P1]\` reads the byte whose address is in P1; \`ST [P2], R0\` writes R0 to the address in P2.
\`INCP\` advances a pointer by one. *memory-copy* copies a string from ROM to RAM at 0x2100 this way and then prints
the copy. A **watchpoint** stops execution right after an instruction accesses an address.`,
    setup: { kind: 'bare', file: 'examples/memory-copy.asm' },
    lab: 'memory',
    steps: [
      {
        title: 'Watch the destination',
        body: `In the Memory lab, go to \`0x2100\`, click the byte and **Add watchpoint** (write). Then **Run**. The machine
stops right after the first store into the buffer.`,
        lab: 'memory',
        check: {
          kind: 'all',
          checks: [
            { kind: 'stopped', reason: 'watchpoint' },
            { kind: 'mem', at: 0x2100, value: 0x54 },
          ],
        },
        hint: '0x54 is the character "T", the first letter of the string.',
        solution: [
          { do: 'watch', at: 0x2100, access: 'w' },
          { do: 'run', cycles: 10_000 },
        ],
      },
      {
        title: 'Let it finish',
        body: 'Remove the watchpoint (or keep it and run a few more times) and run to the end. The copy is printed.',
        check: {
          kind: 'all',
          checks: [
            { kind: 'stopped', reason: 'halted' },
            { kind: 'terminalIncludes', text: 'This string was copied from ROM to RAM 0x2100.' },
          ],
        },
        solution: [
          { do: 'unwatch', at: 0x2100 },
          { do: 'run', cycles: 100_000 },
        ],
      },
    ],
    experiments: [
      'Change `dest` to 0x1000 and rebuild. What happens when the program stores into ROM? (See the stop reason.)',
      'Use the Find box in the Memory lab to search for the text "ROM".',
    ],
    observations: ['The hex view highlights the bytes that changed since the previous update.'],
    examples: ['memory-copy'],
  },
  {
    id: 'stack',
    number: 6,
    title: 'Stack operations and subroutine calls',
    summary: 'PUSH, CALL and RET move SP; arguments sit above the return address.',
    objectives: [
      'Follow SP as values are pushed and popped',
      'Find a return address on the stack',
      'Read stack arguments with SP-relative addressing',
    ],
    explanation: `The stack grows **down**: PUSH decrements SP and writes; POP reads and increments. \`CALL\` pushes the
16-bit return address (high byte first, so the low byte ends up at the lower address) and jumps; \`RET\` pops it.
*stack-demo* pushes two arguments, calls \`add2\`, which reads them at [SP+3] and [SP+2].`,
    setup: { kind: 'bare', file: 'examples/stack-demo.asm' },
    lab: 'memory',
    steps: [
      {
        title: 'Inside the call',
        body: `Run to \`add2\`. SP has gone from 0x3000 to 0x2FFC: two argument bytes plus a two-byte return address. The
Memory lab's stack panel lists them from SP upward.`,
        lab: 'memory',
        check: {
          kind: 'all',
          checks: [
            { kind: 'pausedAt', at: 'add2' },
            { kind: 'reg', reg: 'SP', value: 0x2ffc },
            { kind: 'mem', at: 0x2ffe, value: 12 },
            { kind: 'mem', at: 0x2fff, value: 30 },
          ],
        },
        solution: [
          { do: 'step', count: 1 },
          { do: 'runTo', at: 'add2' },
        ],
      },
      {
        title: 'Back in the caller',
        body: 'Run to the end. The caller removed its arguments (ADDP SP, #2), and R7 holds 30 + 12 = 42.',
        check: {
          kind: 'all',
          checks: [
            { kind: 'stopped', reason: 'halted' },
            { kind: 'reg', reg: 'R7', value: 42 },
            { kind: 'reg', reg: 'SP', value: 0x3000 },
          ],
        },
        solution: [{ do: 'run', cycles: 2000 }],
      },
    ],
    experiments: ['Load the *recursion* example and watch the stack grow for fib(10). How deep does it get?'],
    observations: ['The return address on the stack is the address of the instruction after CALL.'],
    examples: ['stack-demo', 'recursion'],
  },
  {
    id: 'first-program',
    number: 7,
    title: 'Writing and assembling a first program',
    summary: 'Edit source, read assembler diagnostics, build and run your change.',
    objectives: [
      'Edit an assembly program and rebuild it',
      'Read a diagnostic and find the offending line',
      'Map a source line to its machine-code bytes',
    ],
    explanation: `The **Assembly editor** holds every source file. *Assemble* checks the code without touching the
machine; **Build & load** assembles and power-cycles the machine with the new image. Clicking a line shows its address
and bytes; diagnostics link back to the line.`,
    setup: { kind: 'bare', file: 'examples/first-program.asm' },
    lab: 'editor',
    steps: [
      {
        title: 'Inspect the machine code',
        body: `Open \`examples/first-program.asm\` and click the line \`ADD R0, R1\`. The inspector shows its address
(0x0106) and bytes. Then make a mistake on purpose — change \`R1\` to \`R9\` — and press **Assemble** to see the
diagnostic. Undo it before continuing.`,
        lab: 'editor',
        check: { kind: 'loaded', label: 'first-program' },
      },
      {
        title: 'Sum 1 to 5 instead',
        body: `Change \`MOV R1, #10\` to \`MOV R1, #5\`, press **Build & load** (<kbd>Ctrl</kbd>+<kbd>Enter</kbd>) and **Run**.
The LEDs now show 15 (0b00001111).`,
        check: {
          kind: 'all',
          checks: [
            { kind: 'sourceLoaded', file: 'examples/first-program.asm', text: 'MOV R1, #5 ' },
            { kind: 'stopped', reason: 'halted' },
            { kind: 'leds', value: 15 },
          ],
        },
        solution: [
          { do: 'edit', file: 'examples/first-program.asm', find: 'MOV R1, #10 ', replace: 'MOV R1, #5  ' },
          { do: 'build' },
          { do: 'run', cycles: 10_000 },
        ],
      },
    ],
    experiments: [
      'Create a new file in the editor, write a loop of your own and use "Run this file bare-metal".',
      'Look at the listing and symbols tabs. Where did the assembler place `message`?',
    ],
    observations: ['Until you rebuild, a banner warns that the sources differ from the loaded machine.'],
    examples: ['first-program'],
  },
  {
    id: 'mmio',
    number: 8,
    title: 'Understanding memory-mapped I/O',
    summary: 'Devices are registers at addresses: a store to 0xF030 prints a character.',
    objectives: [
      'Find device registers in the 0xF000–0xFFFF region',
      'Poll a STATUS register before writing DATA',
      'See a single store produce terminal output',
    ],
    explanation: `There are no special I/O instructions. The terminal's **STATUS** register is at 0xF031 and its **DATA**
register at 0xF030: \`ST [TERM_DATA], R0\` *is* the output. Reads of device registers can have side effects (reading
the keyboard's DATA removes a key), so the workbench's views use side-effect-free peeks.`,
    setup: { kind: 'bare', file: 'examples/hello-terminal.asm' },
    lab: 'devices',
    steps: [
      {
        title: 'Poll the status register',
        body: 'Step until the program reaches `wait`, the loop that reads the terminal STATUS register.',
        check: { kind: 'pausedAt', at: 'wait' },
        solution: [
          { do: 'step', count: 1 },
          { do: 'runTo', at: 'wait' },
        ],
      },
      {
        title: 'One store, one character',
        body: `Step four more instructions: LD STATUS, AND, JEQ (not taken: the terminal is ready) and the ST to DATA.
Exactly one character appears in the terminal, and the Devices lab counts one byte written.`,
        lab: 'devices',
        check: {
          kind: 'all',
          checks: [
            { kind: 'terminalIncludes', text: 'H' },
            { kind: 'instructionsAtLeast', count: 6 },
          ],
        },
        solution: [{ do: 'step', count: 4 }],
      },
      {
        title: 'The whole message',
        body: 'Run to the end.',
        check: {
          kind: 'all',
          checks: [
            { kind: 'stopped', reason: 'halted' },
            { kind: 'terminalIncludes', text: 'Hello, world! (from a bare-metal VC-8 program)' },
          ],
        },
        solution: [{ do: 'run', cycles: 50_000 }],
      },
    ],
    experiments: [
      'Load *keyboard-echo* and type in the terminal: the program polls the keyboard STATUS register.',
      'Load *led-blink* and change the switches in the Devices lab while it runs.',
    ],
    observations: ['The Memory lab shows the device registers in the 0xF000 region in a distinct colour.'],
    examples: ['hello-terminal', 'keyboard-echo', 'led-blink'],
  },
  {
    id: 'reset-vector',
    number: 9,
    title: 'Following the reset vector',
    summary: 'Power-on and the reset button: what the CPU does before the first instruction.',
    objectives: [
      'Step the five reset micro-operations',
      'Explain where the first instruction address comes from',
      'Distinguish the reset button from a power cycle',
    ],
    explanation: `At reset the CPU enters supervisor mode with interrupts disabled and reads a 16-bit address from
**0x0000–0x0001** in ROM: the reset vector. For the operating system build, the ROM holds the boot firmware and its
vector points at \`fw_reset\`. The **Reset** button resets the CPU and devices but keeps RAM; **Power** reloads
everything.`,
    setup: { kind: 'os', programs: DEFAULT_OS },
    lab: 'boot',
    steps: [
      {
        title: 'Five micro-operations',
        body: `Press **µStep** five times (Datapath lab). The reset sequence reads the two vector bytes and loads PC. PC now
equals the address of \`fw_reset\`, and the CPU is in supervisor mode.`,
        lab: 'datapath',
        check: {
          kind: 'all',
          checks: [
            { kind: 'pausedAt', at: 'fw_reset' },
            { kind: 'cyclesAtLeast', cycles: 5 },
            { kind: 'mode', mode: 'supervisor' },
          ],
        },
        solution: [{ do: 'micro', count: 5 }],
      },
      {
        title: 'Run into the kernel',
        body: 'Run to `kernel_entry` (Boot lab: **Run to kernel entry**).',
        lab: 'boot',
        check: { kind: 'pausedAt', at: 'kernel_entry' },
        solution: [{ do: 'runTo', at: 'kernel_entry', maxCycles: 1_000_000 }],
      },
      {
        title: 'Press Reset',
        body: `Press **Reset** and step once. The CPU starts over at \`fw_reset\` — but the cycle counter keeps counting and
RAM still holds the kernel the firmware copied.`,
        check: {
          kind: 'all',
          checks: [
            { kind: 'pausedAt', at: 'fw_reset' },
            { kind: 'cyclesAtLeast', cycles: 10_000 },
            { kind: 'kernelInRam' },
          ],
        },
        solution: [
          { do: 'command', command: { type: 'reset' } },
          { do: 'step', count: 1 },
        ],
      },
    ],
    experiments: ['Press Power instead of Reset. What happens to RAM and the cycle counter?'],
    observations: ['Reset takes 5 cycles; the first firmware instruction starts at cycle 5.'],
    examples: ['os-boot'],
  },
  {
    id: 'firmware',
    number: 10,
    title: 'Watching firmware load the kernel',
    summary: 'The ROM reads blocks from storage and copies the kernel into RAM, one byte at a time.',
    objectives: [
      'Identify the firmware disk-read routine',
      'Catch the first kernel byte being written to RAM',
      'Confirm the kernel in RAM matches the disk image',
    ],
    explanation: `The workbench never copies the kernel into RAM itself. The firmware reads block 0 (the boot header),
validates it, then reads the kernel blocks through the storage controller's DATA port and stores each byte at the load
address. It checks a checksum and jumps to the kernel entry point.`,
    setup: { kind: 'os', programs: DEFAULT_OS },
    lab: 'boot',
    steps: [
      {
        title: 'The disk driver in ROM',
        body: 'Run to `fw_disk_read`, the firmware routine that reads one block.',
        check: { kind: 'pausedAt', at: 'fw_disk_read' },
        solution: [{ do: 'runTo', at: 'fw_disk_read' }],
      },
      {
        title: 'The first kernel byte',
        body: `Add a write watchpoint on 0x2000 (Boot lab: **Watch first kernel byte being written**) and run. The CPU
stops right after the store that puts the first kernel byte into RAM.`,
        check: {
          kind: 'all',
          checks: [
            { kind: 'stopped', reason: 'watchpoint' },
            { kind: 'kernelInRam', bytes: 1 },
          ],
        },
        solution: [
          { do: 'watch', at: 0x2000, access: 'w' },
          { do: 'run', cycles: 1_000_000 },
          { do: 'unwatch', at: 0x2000 },
        ],
      },
      {
        title: 'The whole image',
        body: 'Run to `kernel_entry`. The Boot lab progress bar shows every kernel byte in RAM matching the disk.',
        check: { kind: 'all', checks: [{ kind: 'pausedAt', at: 'kernel_entry' }, { kind: 'kernelInRam' }] },
        solution: [{ do: 'runTo', at: 'kernel_entry', maxCycles: 1_000_000 }],
      },
    ],
    experiments: ['Slow the clock to 10 kHz and watch the Memory lab at 0x2000 fill in.'],
    observations: ['Each storage read takes simulated time: the firmware polls STATUS until the block is ready.'],
    examples: ['os-boot'],
  },
  {
    id: 'modes',
    number: 11,
    title: 'Supervisor mode and user mode',
    summary: 'The S bit in the PSW decides what code may do; the kernel enters user mode with RTI.',
    objectives: [
      'Find the S bit in the PSW',
      'See the kernel start a user program with RTI',
      'Compare time spent in each mode',
    ],
    explanation: `In **supervisor** mode (S = 1) code may run privileged instructions and access all memory. In **user**
mode it is restricted to its window [UBASE, ULIMIT) and cannot touch devices or control registers. The kernel starts
a program by building an exception frame whose saved PSW has S = 0 and executing RTI.`,
    setup: { kind: 'os', programs: DEFAULT_OS },
    lab: 'kernel',
    steps: [
      {
        title: 'The first user instruction',
        body: `Run to address 0x6000, the start of the first program's slot. The PSW's S flag is clear: the CPU is in user
mode, and UBASE/ULIMIT (CPU lab) delimit the program's window.`,
        lab: 'cpu',
        check: {
          kind: 'all',
          checks: [
            { kind: 'pausedAt', at: 0x6000 },
            { kind: 'mode', mode: 'user' },
          ],
        },
        solution: [{ do: 'runTo', at: 0x6000, maxCycles: 1_000_000 }],
      },
      {
        title: 'Time in each mode',
        body: `Run for a while (about 100,000 cycles), then pause. The Kernel lab shows how the cycles split between user
programs, the kernel and idle, and lists the SYS traps (vector 4) the programs made.`,
        lab: 'kernel',
        check: {
          kind: 'all',
          checks: [
            { kind: 'userCyclesAtLeast', cycles: 20_000 },
            { kind: 'exceptionSeen', vector: 4, minCount: 5 },
          ],
        },
        solution: [{ do: 'run', cycles: 100_000 }],
      },
    ],
    experiments: ['Load the *privileged-fault* example: what happens when user code tries CLI?'],
    observations: ['Every SYS, interrupt and fault switches to supervisor mode; RTI switches back.'],
    examples: ['syscall-trap', 'os-boot'],
  },
  {
    id: 'syscalls',
    number: 12,
    title: 'System calls and privilege transitions',
    summary: 'SYS traps into the supervisor; RTI returns to the instruction after it.',
    objectives: [
      'Follow a SYS trap into its handler',
      'Find the arguments a program passed in registers',
      'Explain why user code cannot print directly',
    ],
    explanation: `A user program asks the supervisor for a service with \`SYS\`. The CPU pushes PC and PSW, switches to
supervisor mode and jumps to vector 4. *syscall-trap* is a tiny supervisor and a user program in one file: the user code
puts a request number in R0 and a character in R1.`,
    setup: { kind: 'bare', file: 'examples/syscall-trap.asm' },
    lab: 'cpu',
    steps: [
      {
        title: 'Into user mode',
        body: 'Run to `user`: the supervisor built a frame and executed RTI into user mode.',
        check: {
          kind: 'all',
          checks: [
            { kind: 'pausedAt', at: 'user' },
            { kind: 'mode', mode: 'user' },
          ],
        },
        solution: [
          { do: 'step', count: 1 },
          { do: 'runTo', at: 'user' },
        ],
      },
      {
        title: 'The trap',
        body: `Run to \`on_sys\`. The CPU is back in supervisor mode; R0 = 1 (the request) and R1 = 0x50 ("P", the first
character). The stack holds the saved PSW and the return address.`,
        check: {
          kind: 'all',
          checks: [
            { kind: 'pausedAt', at: 'on_sys' },
            { kind: 'mode', mode: 'supervisor' },
            { kind: 'reg', reg: 'R0', value: 1 },
            { kind: 'reg', reg: 'R1', value: 0x50 },
            { kind: 'exceptionSeen', vector: 4 },
          ],
        },
        solution: [{ do: 'runTo', at: 'on_sys' }],
      },
      {
        title: 'Many round trips',
        body: 'Run to the end: one SYS per character, then a final SYS with R0 = 0 that halts.',
        check: {
          kind: 'all',
          checks: [
            { kind: 'stopped', reason: 'halted' },
            { kind: 'terminalIncludes', text: 'Printed by user code through SYS' },
            { kind: 'exceptionSeen', vector: 4, minCount: 30 },
          ],
        },
        solution: [{ do: 'run', cycles: 200_000 }],
      },
    ],
    experiments: ['In the OS build, run to `syscall_dispatch` and look at R0: which system call is it?'],
    observations: ['The trace shows an exception entry for every SYS.'],
    examples: ['syscall-trap', 'os-syscalls'],
  },
  {
    id: 'interrupts',
    number: 13,
    title: 'Interrupt vectors and exception handling',
    summary: 'A device raises an IRQ; the CPU saves state, enters the vector, and RTI resumes.',
    objectives: [
      'Enable an interrupt at the device, the PIC and the CPU',
      'Inspect the exception frame on the stack',
      'Acknowledge an interrupt in the handler',
    ],
    explanation: `An interrupt must pass three gates: the device must have interrupts enabled, the interrupt controller
(PIC) must not mask the line, and the CPU's I flag must be set. The CPU then finishes the current instruction, pushes
PC and PSW, clears I and jumps through vector 8 + line. *timer-interrupt* counts ten timer interrupts.`,
    setup: { kind: 'bare', file: 'examples/timer-interrupt.asm' },
    lab: 'devices',
    steps: [
      {
        title: 'The first interrupt',
        body: `Run to \`tick\`, the handler. The CPU entered vector 8 (IRQ 0). SP dropped by three bytes: the frame holds
the PSW at [SP] and the interrupted PC at [SP+1..2].`,
        check: {
          kind: 'all',
          checks: [
            { kind: 'pausedAt', at: 'tick' },
            { kind: 'exceptionSeen', vector: 8 },
            { kind: 'reg', reg: 'SP', value: 0x2ffd },
            { kind: 'flag', flag: 'I', set: false },
          ],
        },
        solution: [
          { do: 'step', count: 1 },
          { do: 'runTo', at: 'tick' },
        ],
      },
      {
        title: 'Ten interrupts',
        body: 'Run to the end. The counter at 0x2000 reaches 10.',
        check: {
          kind: 'all',
          checks: [
            { kind: 'stopped', reason: 'halted' },
            { kind: 'mem', at: 0x2000, value: 10 },
            { kind: 'terminalIncludes', text: '10 timer interrupts handled.' },
          ],
        },
        solution: [{ do: 'run', cycles: 50_000 }],
      },
    ],
    experiments: [
      'Remove the acknowledging store in `tick` and rebuild. What happens, and why?',
      'Enable "break on interrupts" in the Trace lab and run.',
    ],
    observations: ['Between interrupts the CPU waits in HLT: the trace shows idle cycles.'],
    examples: ['timer-interrupt'],
  },
  {
    id: 'device-routine',
    number: 14,
    title: 'Writing or modifying a device routine',
    summary: "Change the kernel's LED driver, rebuild the system, and watch every program use it.",
    objectives: [
      'Find a driver routine in the kernel source',
      'Modify it and rebuild the whole system',
      'Observe the change through a user program',
    ],
    explanation: `User programs cannot touch devices; they call the kernel. The \`setled\` system call ends in the driver
routine \`led_set\` in \`kernel/drivers.asm\`, a single store to the GPIO LED register. Here the system runs one
program, *blinker*, which walks a light across the LEDs and finally switches them all off.`,
    setup: { kind: 'os', programs: [prog('blinker')] },
    lab: 'devices',
    steps: [
      {
        title: 'The original driver',
        body: 'Run the system until blinker exits. The LEDs end all off.',
        check: {
          kind: 'all',
          checks: [
            { kind: 'process', name: 'blinker', exitCode: 0 },
            { kind: 'leds', value: 0 },
          ],
        },
        solution: [{ do: 'run', cycles: 600_000 }],
      },
      {
        title: 'Invert the LEDs',
        body: `In \`kernel/drivers.asm\`, add \`XOR R0, #0xFF\` before the store in \`led_set\`. **Build & load** and run
again. Every pattern is inverted — and at the end all LEDs are on, although blinker still asks for 0.`,
        lab: 'editor',
        check: {
          kind: 'all',
          checks: [
            { kind: 'sourceLoaded', file: 'kernel/drivers.asm', text: 'XOR R0, #0xFF' },
            { kind: 'process', name: 'blinker', exitCode: 0 },
            { kind: 'leds', value: 0xff },
          ],
        },
        solution: [
          {
            do: 'edit',
            file: 'kernel/drivers.asm',
            find: 'led_set:\n        ST [GPIO_LEDS], R0',
            replace: 'led_set:\n        XOR R0, #0xFF\n        ST [GPIO_LEDS], R0',
          },
          { do: 'build' },
          { do: 'run', cycles: 600_000 },
        ],
      },
    ],
    experiments: ['Change `kputc` so that the kernel prints every character twice. Which output is affected?'],
    observations: ['The kernel is ordinary source code: rebuilding writes a new kernel image to the boot disk.'],
    examples: ['os-interactive'],
  },
  {
    id: 'timer',
    number: 15,
    title: 'Programming the timer',
    summary: 'RELOAD, CTRL and STATUS: periodic interrupts at a chosen rate.',
    objectives: [
      'Configure the timer period through its registers',
      'Measure the interval between interrupts in cycles',
      'Relate the period to total run time',
    ],
    explanation: `The timer counts down once per clock cycle from RELOAD. When it reaches zero it sets EXPIRED, raises
IRQ 0 if enabled, and in periodic mode reloads. *timer-interrupt* sets RELOAD to 500.`,
    setup: { kind: 'bare', file: 'examples/timer-interrupt.asm' },
    lab: 'devices',
    steps: [
      {
        title: 'A 500-cycle timer',
        body: 'Run to the end. The Devices lab shows RELOAD = 500; ten interrupts took a little over 5,000 cycles.',
        check: {
          kind: 'all',
          checks: [
            { kind: 'timerReload', value: 500 },
            { kind: 'stopped', reason: 'halted' },
            { kind: 'terminalIncludes', text: '10 timer interrupts handled.' },
          ],
        },
        solution: [{ do: 'run', cycles: 50_000 }],
      },
      {
        title: 'Slow it down',
        body: `Change \`MOVP P0, #500\` to \`MOVP P0, #2000\`, **Build & load** and run. Ten interrupts now take over 20,000
cycles.`,
        lab: 'editor',
        check: {
          kind: 'all',
          checks: [
            { kind: 'sourceLoaded', file: 'examples/timer-interrupt.asm', text: 'MOVP P0, #2000' },
            { kind: 'timerReload', value: 2000 },
            { kind: 'stopped', reason: 'halted' },
            { kind: 'cyclesAtLeast', cycles: 20_000 },
          ],
        },
        solution: [
          { do: 'edit', file: 'examples/timer-interrupt.asm', find: 'MOVP P0, #500', replace: 'MOVP P0, #2000' },
          { do: 'build' },
          { do: 'run', cycles: 100_000 },
        ],
      },
    ],
    experiments: ['What is the smallest period at which the handler still keeps up?'],
    observations: ['The timer runs on simulated cycles, so the result never depends on the clock-speed setting.'],
    examples: ['timer-interrupt'],
  },
  {
    id: 'context',
    number: 16,
    title: 'Saving and restoring process state',
    summary: 'The kernel saves every register of an interrupted process and restores them exactly.',
    objectives: [
      'Find a saved trap frame in kernel memory',
      'List what a context contains',
      'Verify that preemption never corrupts registers',
    ],
    explanation: `When the timer interrupts a program, the CPU pushes PC and PSW; the kernel's \`trap_entry\` then pushes
R0–R7 and the user stack pointer onto the process's own kernel stack. That 13-byte **trap frame** is the process's
saved context. Switching processes means switching kernel stacks; \`resume_current\` pops the frame and RTI returns.
*regcheck* fills all registers with a pattern and checks it continuously.`,
    setup: { kind: 'os', programs: [prog('regcheck'), prog('regcheck'), prog('spinner')] },
    lab: 'processes',
    steps: [
      {
        title: 'A timer interrupt arrives',
        body: 'Run to `timer_interrupt`, the kernel code that runs after a timer IRQ has saved the context.',
        lab: 'kernel',
        check: {
          kind: 'all',
          checks: [
            { kind: 'pausedAt', at: 'timer_interrupt' },
            { kind: 'exceptionSeen', vector: 8 },
          ],
        },
        solution: [{ do: 'runTo', at: 'timer_interrupt', maxCycles: 1_000_000 }],
      },
      {
        title: 'Saved contexts',
        body: `Run for a while and pause. In the Processes lab, every process that is not on the CPU shows its saved PC,
user SP, R0–R7 and PSW, decoded from its trap frame in kernel memory.`,
        lab: 'processes',
        check: {
          kind: 'all',
          checks: [
            { kind: 'savedFrames', count: 2 },
            { kind: 'ticksAtLeast', ticks: 25 },
          ],
        },
        solution: [{ do: 'run', cycles: 60_000 }],
      },
      {
        title: 'Nothing was lost',
        body: 'Run until both regcheck processes exit. Exit code 0 means every register survived every switch.',
        check: {
          kind: 'all',
          checks: [
            { kind: 'process', name: 'regcheck', exitCode: 0 },
            { kind: 'terminalIncludes', text: 'all processes have finished' },
          ],
        },
        solution: [{ do: 'run', cycles: 6_000_000 }],
      },
    ],
    experiments: ['In `kernel/trap.asm`, find where R7 is pushed. What would happen if one register were skipped?'],
    observations: ["The trap frame lives at the top of each process's kernel stack, not in user memory."],
    examples: ['os-regcheck'],
  },
  {
    id: 'preemption',
    number: 17,
    title: 'Timer-driven preemptive multitasking',
    summary: 'Two loops that never yield both make progress, because the timer interrupts them.',
    objectives: [
      'Watch the scheduler alternate between processes',
      'Change the time slice and observe its effect',
      'Explain the role of the timer in preemption',
    ],
    explanation: `*spinner* is a pure computation loop with no system calls: it would never give up the CPU by itself.
The kernel programs the timer with a period of QUANTUM cycles. Every expiry interrupts the running process; the
scheduler saves it and resumes the next ready one in round-robin order.`,
    setup: { kind: 'os', programs: [prog('spinner'), prog('spinner')] },
    lab: 'processes',
    steps: [
      {
        title: 'Round robin',
        body: `Run until the programs have started (booting takes about 250,000 cycles), let them run for a while and pause.
The timeline shows the two processes alternating; both have been dispatched several times.`,
        check: {
          kind: 'all',
          checks: [
            { kind: 'ticksAtLeast', ticks: 20 },
            { kind: 'process', name: 'spinner', dispatchesAtLeast: 5 },
            { kind: 'savedFrames', count: 1 },
          ],
        },
        solution: [{ do: 'run', cycles: 330_000 }],
      },
      {
        title: 'A shorter time slice',
        body: `In \`kernel/main.asm\` change \`QUANTUM = 2000\` to \`500\`, **Build & load** and run again. The timer ticks
four times as often, the timeline segments are much shorter — and the programs take far longer to finish, because each
switch costs hundreds of kernel cycles.`,
        lab: 'editor',
        check: {
          kind: 'all',
          checks: [
            { kind: 'sourceLoaded', file: 'kernel/main.asm', text: '= 500 ' },
            { kind: 'ticksAtLeast', ticks: 150 },
            { kind: 'timerReload', value: 500 },
          ],
        },
        solution: [
          { do: 'edit', file: 'kernel/main.asm', find: '= 2000          ;', replace: '= 500           ;' },
          { do: 'build' },
          { do: 'run', cycles: 330_000 },
        ],
      },
    ],
    experiments: ['Read docs/os/preemption-walkthrough.md (Reference lab) and follow one switch with µStep.'],
    observations: ['A shorter quantum means more switches, so more time is spent in the kernel.'],
    examples: ['os-preemption', 'os-multitasking'],
  },
  {
    id: 'protection',
    number: 18,
    title: 'Investigating a protection fault',
    summary: 'A user store outside its window is stopped by the CPU before it happens.',
    objectives: [
      'Catch a memory fault before the handler runs',
      'Read CAUSE and FADDR',
      'See the kernel terminate only the offending process',
    ],
    explanation: `In user mode every access is checked against the window [UBASE, ULIMIT). A violating access is not
performed: the instruction is abandoned (PC still points at it), CAUSE and FADDR record why and where, and the CPU
enters vector 3. With "break on faults" enabled (the default), the debugger pauses just before the exception is
entered.`,
    setup: { kind: 'bare', file: 'examples/protection-fault.asm' },
    lab: 'cpu',
    steps: [
      {
        title: 'Caught in the act',
        body: 'Run. The debugger pauses: a write violation is pending, and the CPU is still in user mode.',
        check: {
          kind: 'all',
          checks: [
            { kind: 'stopped', reason: 'exception' },
            { kind: 'pendingException', vector: 3 },
            { kind: 'mode', mode: 'user' },
          ],
        },
        solution: [{ do: 'run', cycles: 10_000 }],
      },
      {
        title: 'The handler explains',
        body: 'Run again. The handler prints CAUSE = 0x04 (write violation) and FADDR = 0x7000.',
        check: {
          kind: 'all',
          checks: [
            { kind: 'stopped', reason: 'halted' },
            { kind: 'terminalIncludes', text: 'CAUSE=0x04 FADDR=0x7000' },
          ],
        },
        solution: [{ do: 'run', cycles: 50_000 }],
      },
    ],
    experiments: [
      'Load the *os-isolation* example: three faulty programs are killed while a fourth keeps running.',
      'Change the store to 0x6FFF and rebuild: is it still a fault?',
    ],
    observations: ['The faulting store never reaches memory: 0x7000 is unchanged.'],
    examples: ['protection-fault', 'privileged-fault', 'os-isolation'],
  },
];
