/**
 * Curated example catalog. Every example is real VC-8 source in src/guest,
 * built by the same assembler and run on the same emulator as everything
 * else. Each has a declarative check that both the UI ("Run & check") and
 * the automated tests (tests/integration/examples.test.ts) evaluate.
 */
import type { ProgramSpec } from '../core/build/system';
import type { ProcessInfo } from '../core/os/awareness';
import type { LabId } from '../app/store';
import type { MachineView } from '../host/protocol';

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export interface ExampleCheck {
  /** Cycles to run after power-on. */
  cycles: number;
  /** Text typed on the virtual keyboard right after power-on. */
  keys?: string;
  terminalIncludes?: string[];
  regs?: Record<string, number>;
  mem?: Record<number, number>;
  leds?: number;
  processes?: { name: string; exitCode?: number; state?: string }[];
  /** The run must end with the CPU halted (HLT with no interrupt line enabled), not by using up the budget. */
  halted?: boolean;
  /** Minimum number of writes to the LED register. */
  ledWritesAtLeast?: number;
}

export interface Example {
  id: string;
  title: string;
  difficulty: Difficulty;
  kind: 'bare' | 'os';
  /** Bare-metal program file. */
  file?: string;
  /** OS build: programs on the boot disk. */
  programs?: ProgramSpec[];
  description: string;
  expected: string;
  concepts: string[];
  lab: LabId;
  check: ExampleCheck;
}

const p = (name: string, file = name): ProgramSpec => ({ name, path: `programs/${file}.asm` });

export const EXAMPLES: Example[] = [
  {
    id: 'first-program',
    title: 'First program: sum 1..10',
    difficulty: 'beginner',
    kind: 'bare',
    file: 'examples/first-program.asm',
    description: 'A loop that adds 10 numbers, stores the result in RAM, shows it on the LEDs and prints a message.',
    expected: 'R0 = 0x37 (55); RAM 0x2000 = 0x37; LEDs show 00110111; a message on the terminal.',
    concepts: ['registers', 'loops', 'flags', 'memory-mapped I/O'],
    lab: 'cpu',
    check: {
      halted: true,
      cycles: 20_000,
      regs: { R0: 0x37 },
      mem: { 0x2000: 0x37 },
      leds: 0x37,
      terminalIncludes: ['1 + 2 + ... + 10 = 0x37'],
    },
  },
  {
    id: 'register-arithmetic',
    title: 'Register arithmetic and 16-bit pairs',
    difficulty: 'beginner',
    kind: 'bare',
    file: 'examples/register-arithmetic.asm',
    description:
      'Adds 16-bit numbers byte by byte with ADD/ADC, then with ADDP; shows a subtraction result read as unsigned and signed.',
    expected: 'P0 = 0x1410, R4 = 0xFE (254 or -2), R5 = 0x02, P1 = 0x1530.',
    concepts: ['8-bit registers', 'register pairs', 'carry chain', "two's complement"],
    lab: 'cpu',
    check: {
      halted: true,
      cycles: 5_000,
      regs: { R0: 0x14, R1: 0x10, R4: 0xfe, R5: 0x02, R2: 0x15, R3: 0x30 },
    },
  },
  {
    id: 'overflow-carry',
    title: 'Overflow vs. carry',
    difficulty: 'beginner',
    kind: 'bare',
    file: 'examples/overflow-carry.asm',
    description:
      'Four operations whose flags are copied from the PSW into RAM: signed overflow, unsigned carry, and both kinds of borrow.',
    expected: 'RAM 0x2000–0x2003 = 0C 03 08 05 (flag bits V N Z C).',
    concepts: ['flags', 'signed overflow', 'carry and borrow'],
    lab: 'cpu',
    check: {
      halted: true,
      cycles: 10_000,
      mem: { 0x2000: 0x0c, 0x2001: 0x03, 0x2002: 0x08, 0x2003: 0x05 },
    },
  },
  {
    id: 'conditional-loop',
    title: 'Conditional loop: signed vs unsigned',
    difficulty: 'beginner',
    kind: 'bare',
    file: 'examples/conditional-loop.asm',
    description:
      'Walks a table with a pointer and counts entries above 50 using unsigned (JLEU) and signed (JLE) branches.',
    expected: 'R0 = 3 (unsigned), R1 = 2 (signed): 200 is -56 when read as signed.',
    concepts: ['branches', 'CMP', 'signed/unsigned conditions', 'pointers'],
    lab: 'cpu',
    check: {
      halted: true,
      cycles: 10_000,
      regs: { R0: 3, R1: 2 },
    },
  },
  {
    id: 'memory-copy',
    title: 'Memory copy with pointers',
    difficulty: 'intermediate',
    kind: 'bare',
    file: 'examples/memory-copy.asm',
    description:
      'Copies a NUL-terminated string from ROM to RAM with register-indirect loads and stores, then prints the copy.',
    expected: 'RAM from 0x2100 holds the string; the terminal shows it.',
    concepts: ['register-indirect addressing', 'INCP', 'subroutines'],
    lab: 'memory',
    check: {
      halted: true,
      cycles: 30_000,
      mem: { 0x2100: 0x54 },
      terminalIncludes: ['This string was copied from ROM to RAM 0x2100.'],
    },
  },
  {
    id: 'stack-demo',
    title: 'Stack: arguments and return addresses',
    difficulty: 'intermediate',
    kind: 'bare',
    file: 'examples/stack-demo.asm',
    description: 'Pushes two arguments, calls a subroutine that reads them with SP-relative addressing, and cleans up.',
    expected: 'R7 = 42; SP back at 0x3000.',
    concepts: ['stack', 'CALL/RET', 'SP-relative addressing'],
    lab: 'memory',
    check: {
      halted: true,
      cycles: 5_000,
      regs: { R7: 42 },
    },
  },
  {
    id: 'recursion',
    title: 'Recursive Fibonacci',
    difficulty: 'intermediate',
    kind: 'bare',
    file: 'examples/recursion.asm',
    description: 'fib(10) computed recursively; each call saves its state on the stack.',
    expected: 'R0 = 55 (0x37), also stored at RAM 0x2000.',
    concepts: ['recursion', 'stack frames', 'nested calls'],
    lab: 'memory',
    check: {
      halted: true,
      cycles: 100_000,
      regs: { R0: 55 },
      mem: { 0x2000: 55 },
    },
  },
  {
    id: 'hello-terminal',
    title: 'Terminal output',
    difficulty: 'beginner',
    kind: 'bare',
    file: 'examples/hello-terminal.asm',
    description: 'Prints a string by polling the terminal STATUS register and storing each byte to DATA.',
    expected: '"Hello, world!" on the terminal.',
    concepts: ['memory-mapped I/O', 'polling'],
    lab: 'devices',
    check: {
      halted: true,
      cycles: 20_000,
      terminalIncludes: ['Hello, world!'],
    },
  },
  {
    id: 'keyboard-echo',
    title: 'Keyboard input by polling',
    difficulty: 'intermediate',
    kind: 'bare',
    file: 'examples/keyboard-echo.asm',
    description: 'Waits for keys by polling the keyboard STATUS register, echoes them in upper case; "." stops.',
    expected: 'Typing "ab." prints "AB.".',
    concepts: ['input devices', 'FIFO', 'polling'],
    lab: 'devices',
    check: {
      halted: true,
      cycles: 30_000,
      keys: 'ab.',
      terminalIncludes: ['AB.'],
    },
  },
  {
    id: 'led-blink',
    title: 'LED blinking with switches',
    difficulty: 'beginner',
    kind: 'bare',
    file: 'examples/led-blink.asm',
    description: 'Walks a light across the LEDs with a delay loop whose length is read from the switches.',
    expected: 'A light moves across the 8 LEDs twice, then all LEDs are off.',
    concepts: ['GPIO', 'delay loops', 'shifts'],
    lab: 'devices',
    check: {
      halted: true,
      cycles: 1_000_000,
      leds: 0,
      ledWritesAtLeast: 17,
    },
  },
  {
    id: 'timer-interrupt',
    title: 'Timer interrupt handler',
    difficulty: 'advanced',
    kind: 'bare',
    file: 'examples/timer-interrupt.asm',
    description:
      'Programs the timer, unmasks IRQ 0, enables interrupts and handles 10 ticks in an interrupt handler while the main program sleeps in HLT.',
    expected: '10 dots, then "10 timer interrupts handled."; RAM 0x2000 = 10.',
    concepts: ['interrupts', 'vector table', 'RTI', 'HLT', 'acknowledging devices'],
    lab: 'kernel',
    check: {
      halted: true,
      cycles: 60_000,
      mem: { 0x2000: 10 },
      terminalIncludes: ['..........\n10 timer interrupts handled.'],
    },
  },
  {
    id: 'syscall-trap',
    title: 'System call from user mode',
    difficulty: 'advanced',
    kind: 'bare',
    file: 'examples/syscall-trap.asm',
    description:
      'A miniature kernel enters user mode with RTI; the user code prints through SYS traps handled in supervisor mode.',
    expected: '"Printed by user code through SYS" on the terminal.',
    concepts: ['privilege modes', 'SYS trap', 'RTI', 'banked stack pointers'],
    lab: 'kernel',
    check: {
      halted: true,
      cycles: 60_000,
      terminalIncludes: ['Printed by user code through SYS'],
    },
  },
  {
    id: 'privileged-fault',
    title: 'Invalid privileged operation',
    difficulty: 'advanced',
    kind: 'bare',
    file: 'examples/privileged-fault.asm',
    description:
      'User code executes CLI; the CPU raises a privilege fault (vector 2) and the handler reports the faulting PC.',
    expected: '"Privilege fault! Faulting instruction at 0x6003".',
    concepts: ['privileged instructions', 'faults', 'exception frame'],
    lab: 'kernel',
    check: {
      halted: true,
      cycles: 30_000,
      terminalIncludes: ['Privilege fault! Faulting instruction at 0x6003'],
    },
  },
  {
    id: 'protection-fault',
    title: 'Memory-protection fault',
    difficulty: 'advanced',
    kind: 'bare',
    file: 'examples/protection-fault.asm',
    description:
      'User code may access only 0x6000–0x6FFF; its store to 0x7000 is blocked and reported with CAUSE and FADDR.',
    expected: '"Memory fault: CAUSE=0x04 FADDR=0x7000".',
    concepts: ['base/limit protection', 'UBASE/ULIMIT', 'CAUSE/FADDR'],
    lab: 'memory',
    check: {
      halted: true,
      cycles: 30_000,
      terminalIncludes: ['Memory fault: CAUSE=0x04 FADDR=0x7000'],
    },
  },
  {
    id: 'storage-read',
    title: 'Block storage read',
    difficulty: 'intermediate',
    kind: 'bare',
    file: 'examples/storage-read.asm',
    description:
      'Selects block 128, issues READ, polls until DONE and copies 256 bytes through the DATA port (programmed I/O).',
    expected: 'The text stored in block 128 appears on the terminal.',
    concepts: ['block storage', 'command/status registers', 'programmed I/O'],
    lab: 'devices',
    check: {
      halted: true,
      cycles: 60_000,
      terminalIncludes: ['Hello from block storage!'],
    },
  },
  {
    id: 'os-boot',
    title: 'Firmware boot and kernel initialisation',
    difficulty: 'intermediate',
    kind: 'os',
    programs: [p('hello')],
    description:
      'Power on the full system: the ROM loads the kernel from storage, the kernel loads one program and runs it in user mode.',
    expected: 'Boot messages, "Hello from user mode! I am pid 1", then the system halts.',
    concepts: ['reset vector', 'firmware', 'kernel loading', 'kernel initialisation'],
    lab: 'boot',
    check: {
      cycles: 600_000,
      terminalIncludes: [
        'checksum OK',
        'VC-8 Workshop Kernel v1.0',
        'Hello from user mode! I am pid 1',
        'system halted',
      ],
      processes: [{ name: 'hello', exitCode: 0, state: 'exited' }],
    },
  },
  {
    id: 'os-multitasking',
    title: 'Two programs, interleaved output',
    difficulty: 'intermediate',
    kind: 'os',
    programs: [p('alpha'), p('digits')],
    description: 'Two printing programs share the CPU; their output interleaves because the timer preempts them.',
    expected: 'Letters and digits interleaved; both programs exit with code 0.',
    concepts: ['round-robin scheduling', 'time slices'],
    lab: 'processes',
    check: {
      cycles: 3_000_000,
      processes: [
        { name: 'alpha', exitCode: 0 },
        { name: 'digits', exitCode: 0 },
      ],
    },
  },
  {
    id: 'os-preemption',
    title: 'Preemptive multitasking without yielding',
    difficulty: 'advanced',
    kind: 'os',
    programs: [p('spinner'), p('spinner')],
    description:
      'Two pure-computation loops with no system calls. Only timer interrupts and kernel context switches let both progress.',
    expected: 'Both counters advance in turn (Processes lab timeline); both exit with code 0.',
    concepts: ['timer interrupt', 'context switch', 'preemption'],
    lab: 'processes',
    check: {
      cycles: 2_000_000,
      processes: [
        { name: 'spinner', exitCode: 0 },
        { name: 'spinner', exitCode: 0 },
      ],
    },
  },
  {
    id: 'os-regcheck',
    title: 'Context switches preserve every register',
    difficulty: 'advanced',
    kind: 'os',
    programs: [p('regcheck'), p('regcheck'), p('spinner')],
    description: 'Each regcheck process fills R0–R7 with a pattern and verifies it while being preempted many times.',
    expected: 'Both regcheck processes exit with code 0.',
    concepts: ['saved context', 'trap frame', 'per-process kernel stacks'],
    lab: 'processes',
    check: {
      cycles: 6_000_000,
      processes: [
        { name: 'regcheck', exitCode: 0 },
        { name: 'regcheck', exitCode: 0 },
      ],
    },
  },
  {
    id: 'os-interactive',
    title: 'Interrupt-driven keyboard and LEDs',
    difficulty: 'intermediate',
    kind: 'os',
    programs: [p('echo'), p('blinker')],
    description:
      'echo blocks in getc until the keyboard interrupt delivers keys; blinker sleeps on timer ticks between LED updates.',
    expected: 'Typed "hi~" is echoed as "HI" and echo exits; the LEDs walk and turn off.',
    concepts: ['device drivers', 'blocking', 'keyboard interrupt', 'sleep'],
    lab: 'devices',
    check: {
      cycles: 3_000_000,
      keys: 'hi~',
      terminalIncludes: ['HI', '[echo] bye'],
      leds: 0,
      processes: [
        { name: 'echo', exitCode: 0 },
        { name: 'blinker', exitCode: 0 },
      ],
    },
  },
  {
    id: 'os-isolation',
    title: 'Process isolation',
    difficulty: 'advanced',
    kind: 'os',
    programs: [p('intruder'), p('kspy'), p('privileged'), p('digits')],
    description:
      'Three misbehaving programs are each stopped by the CPU and terminated by the kernel; a well-behaved one keeps running.',
    expected: 'intruder, kspy and privileged are killed with clear reasons; digits exits with code 0.',
    concepts: ['memory protection', 'privilege', 'fault handling'],
    lab: 'kernel',
    check: {
      cycles: 3_000_000,
      terminalIncludes: [
        'killed: write protection violation',
        'killed: read protection violation',
        'killed: privileged instruction in user mode',
      ],
      processes: [
        { name: 'intruder', exitCode: 255 },
        { name: 'kspy', exitCode: 255 },
        { name: 'privileg', exitCode: 255 },
        { name: 'digits', exitCode: 0 },
      ],
    },
  },
  {
    id: 'os-syscalls',
    title: 'System-call errors and storage service',
    difficulty: 'intermediate',
    kind: 'os',
    programs: [p('badcall'), p('reader')],
    description:
      'badcall makes an unknown call and passes a kernel pointer; reader asks the kernel to read a disk block.',
    expected: 'The kernel rejects both bad calls; the block-128 text is printed.',
    concepts: ['system-call ABI', 'pointer validation', 'kernel drivers'],
    lab: 'kernel',
    check: {
      cycles: 1_000_000,
      terminalIncludes: ['kernel rejected both bad calls', 'Hello from block storage!'],
      processes: [
        { name: 'badcall', exitCode: 0 },
        { name: 'reader', exitCode: 0 },
      ],
    },
  },
  {
    id: 'os-full',
    title: 'Full demo system',
    difficulty: 'intermediate',
    kind: 'os',
    programs: [p('alpha'), p('digits'), p('echo'), p('blinker')],
    description: 'The default system: two printers, an interactive echo and an LED blinker. Type in the terminal.',
    expected: 'All four processes run; echo waits for your keys.',
    concepts: ['everything together'],
    lab: 'processes',
    check: {
      cycles: 3_000_000,
      terminalIncludes: ['starting round-robin scheduler'],
      processes: [
        { name: 'alpha', exitCode: 0 },
        { name: 'digits', exitCode: 0 },
        { name: 'echo', state: 'blocked' },
        { name: 'blinker', exitCode: 0 },
      ],
    },
  },
];

export interface CheckState {
  terminal: string;
  r: number[];
  peek(addr: number): number;
  leds: number;
  ledWrites: number;
  processes: ProcessInfo[] | null;
  /** Why the check run ended (null if it used its whole cycle budget). */
  stopReason: string | null;
}

/** The state a check reads, taken from a machine view after the check run. */
export function checkStateFromView(v: MachineView): CheckState {
  return {
    terminal: [...v.devices.terminal.lines, v.devices.terminal.current].join('\n'),
    r: v.cpu.r,
    peek: (a) => v.memory[a & 0xffff]!,
    leds: v.devices.gpio.leds,
    ledWrites: v.devices.gpio.ledWrites,
    processes: v.os?.processes ?? null,
    stopReason: v.stop?.reason ?? null,
  };
}

export interface CheckResult {
  ok: boolean;
  passed: string[];
  failed: string[];
}

const h = (v: number) => `0x${v.toString(16).toUpperCase()}`;

export function evaluateCheck(check: ExampleCheck, st: CheckState): CheckResult {
  const passed: string[] = [];
  const failed: string[] = [];
  const t = (ok: boolean, msg: string) => (ok ? passed : failed).push(msg);
  for (const s of check.terminalIncludes ?? []) t(st.terminal.includes(s), `terminal shows "${s}"`);
  for (const [name, v] of Object.entries(check.regs ?? {})) {
    const got = st.r[Number(name.slice(1))]!;
    t(got === v, `${name} = ${h(v)}${got === v ? '' : ` (got ${h(got)})`}`);
  }
  for (const [a, v] of Object.entries(check.mem ?? {})) {
    const got = st.peek(Number(a));
    t(got === v, `RAM ${h(Number(a))} = ${h(v)}${got === v ? '' : ` (got ${h(got)})`}`);
  }
  if (check.halted)
    t(
      st.stopReason === 'halted',
      `program ran to its end (HLT)${st.stopReason === 'halted' ? '' : ` (got ${st.stopReason ?? 'still running'})`}`,
    );
  if (check.ledWritesAtLeast !== undefined)
    t(
      st.ledWrites >= check.ledWritesAtLeast,
      `LEDs written at least ${check.ledWritesAtLeast} times (got ${st.ledWrites})`,
    );
  if (check.leds !== undefined)
    t(st.leds === check.leds, `LEDs = ${h(check.leds)}${st.leds === check.leds ? '' : ` (got ${h(st.leds)})`}`);
  if (check.processes) {
    const procs = st.processes ?? [];
    check.processes.forEach((want, i) => {
      const got = procs[i];
      const ok =
        !!got &&
        got.name === want.name &&
        (want.exitCode === undefined || (got.state === 'exited' && got.exitCode === want.exitCode)) &&
        (want.state === undefined || got.state === want.state);
      t(
        ok,
        `process ${i + 1} "${want.name}" ${want.exitCode !== undefined ? `exits with code ${want.exitCode}` : `is ${want.state}`}${
          ok ? '' : ` (got ${got ? `${got.name}: ${got.state}, code ${got.exitCode}` : 'nothing'})`
        }`,
      );
    });
  }
  return { ok: failed.length === 0, passed, failed };
}
