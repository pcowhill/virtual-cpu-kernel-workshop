/** Exception entry/return, interrupts, masking, HLT, machine-check behaviour. */
import { describe, expect, it } from 'vitest';
import { CAUSE, PSW } from '../../src/core/isa/constants';
import { bareMachine, sym } from '../helpers';

/** Vector table in ROM: every vector points at a named handler label (or 0xFFFF). */
function program(body: string, handlers: string): string {
  return `
      .org 0x0000
      .word start, h_ill, h_priv, h_mem, h_sys, h_brk, 0xFFFF, 0xFFFF, h_timer, h_kbd, h_disk
      .org 0x0100
start:
${body}
${handlers}
`;
}

const DEFAULT_HANDLERS = `
h_ill:   MOV R7, #1
         HLT
h_priv:  MOV R7, #2
         HLT
h_mem:   MOV R7, #3
         HLT
h_sys:   MOV R7, #4
         RTI
h_brk:   MOV R7, #5
         RTI
h_timer: MOV R7, #8
         MOV R6, #1
         ST [0xF021], R6      ; acknowledge timer
         RTI
h_kbd:   MOV R7, #9
         LD R5, [0xF040]      ; dequeue key (deasserts the line)
         RTI
h_disk:  MOV R7, #10
         RTI
`;

/** Enter user mode at `ucode` (in user RAM) via a hand-built frame and RTI. */
const ENTER_USER = `
      MOVP SP, #0x3000
      MOVP P0, #0x7000
      MTC USP, P0
      MOVP P0, #0x8000
      MTC ULIMIT, P0      ; user window = 0x6000-0x7FFF
      MOVP P0, #user
      PUSHP P0            ; PC
      MOV R0, #0x40       ; PSW: user mode, I=1
      PUSH R0
      RTI
`;

function userProgram(userCode: string, handlers = DEFAULT_HANDLERS) {
  const src = program(ENTER_USER, handlers) + `\n      .org 0x6000\nuser:\n${userCode}\n`;
  return machine(src);
}

/** Bare machine that does not pause on faults (these tests want the handlers to run). */
function machine(src: string) {
  const r = bareMachine(src, false);
  r.m.breakOn.faults = false;
  return r;
}

describe('exception entry and RTI', () => {
  it('a syscall from user mode switches to KSP, saves PC/PSW and returns', () => {
    const { m, r } = userProgram('MOV R0, #3\nSYS\nafter: MOV R1, #7\nwait: JMP wait');
    m.run(200, 11); // reset + enter user + MOV + SYS + entry
    // Execute until the handler's MOV R7, #4 has run.
    while (m.cpu.r[7] !== 4) m.stepInstruction();
    const cpu = m.cpu;
    expect(cpu.supervisor).toBe(true);
    expect(cpu.psw & PSW.I).toBe(0);
    expect(cpu.cause).toBe(CAUSE.SYSCALL);
    expect(cpu.ksp).toBe(0x2ffd);
    expect(m.bus.peek(0x2ffd)).toBe(0x40); // saved PSW (user, I=1)
    expect(m.bus.peekWord(0x2ffe)).toBe(sym(r, 'after'));
    expect(cpu.usp).toBe(0x7000); // user stack untouched
    m.stepInstruction(); // RTI
    expect(cpu.supervisor).toBe(false);
    expect(cpu.pc).toBe(sym(r, 'after'));
    expect(cpu.sp).toBe(0x7000);
    expect(cpu.ksp).toBe(0x3000);
    m.stepInstruction();
    expect(cpu.r[1]).toBe(7);
  });

  it('a user-mode read of kernel memory raises a memory fault with FADDR', () => {
    const { m, r } = userProgram('bad: LD R0, [0x2000]\nHLT');
    m.run(1000);
    expect(m.cpu.r[7]).toBe(3);
    expect(m.cpu.cause).toBe(CAUSE.READ_VIOLATION);
    expect(m.cpu.faddr).toBe(0x2000);
    expect(m.bus.peekWord(m.cpu.ksp + 1)).toBe(sym(r, 'bad')); // saved PC = faulting instruction
  });

  it('user code cannot touch devices', () => {
    const { m } = userProgram('MOV R0, #0xFF\nST [0xF050], R0\nHLT');
    m.run(1000);
    expect(m.cpu.cause).toBe(CAUSE.WRITE_VIOLATION);
    expect(m.cpu.faddr).toBe(0xf050);
    expect(m.gpio.leds).toBe(0);
  });

  it('user code cannot fetch outside its window', () => {
    const { m } = userProgram('JMP 0x9000');
    m.run(1000);
    expect(m.cpu.cause).toBe(CAUSE.FETCH_VIOLATION);
    expect(m.cpu.faddr).toBe(0x9000);
  });

  it('a privileged instruction in user mode enters vector 2', () => {
    const { m } = userProgram('CLI\nHLT');
    m.run(1000);
    expect(m.cpu.r[7]).toBe(2);
    expect(m.cpu.cause).toBe(CAUSE.PRIVILEGED_INSTRUCTION);
  });

  it('an illegal opcode enters vector 1', () => {
    const { m } = userProgram('.byte 0xEE');
    m.run(1000);
    expect(m.cpu.r[7]).toBe(1);
    expect(m.cpu.cause).toBe(CAUSE.ILLEGAL_INSTRUCTION);
  });

  it('supervisor access to an undecoded device address is a bus error', () => {
    const { m } = machine(program('LD R0, [0xF800]\nHLT', DEFAULT_HANDLERS));
    m.run(1000);
    expect(m.cpu.cause).toBe(CAUSE.BUS_ERROR);
    expect(m.cpu.faddr).toBe(0xf800);
  });

  it('an absent handler (0xFFFF) stops the CPU in machine check', () => {
    const { m } = bareMachine(
      `
      .org 0
      .word start
      .org 0x100
start: MOVP SP, #0x3000
      SYS`,
      false,
    );
    const res = m.run(1000);
    expect(res.reason).toBe('machine-check');
    expect(m.cpu.status).toBe('machine-check');
    expect(m.cpu.machineCheckReason).toMatch(/vector 4 .*no handler/);
  });

  it('a fault during exception entry is a double fault', () => {
    const { m } = machine(program('MOVP SP, #0x0100\nSYS', DEFAULT_HANDLERS));
    const res = m.run(1000);
    expect(res.reason).toBe('machine-check');
    expect(m.cpu.machineCheckReason).toMatch(/double fault/);
  });

  it('an erased reset vector stops the CPU', () => {
    const { m } = bareMachine(`.org 0x100\nNOP`, false);
    m.run(100);
    expect(m.cpu.status).toBe('machine-check');
    expect(m.cpu.machineCheckReason).toMatch(/reset vector/);
  });
});

const TIMER_SETUP = (reload: number, ctrl = 0x07) => `
      MOVP SP, #0x3000
      MOV R0, #${reload & 0xff}
      ST [0xF022], R0
      MOV R0, #${reload >> 8}
      ST [0xF023], R0
      MOV R0, #${ctrl}     ; 0x07 = EN | IE | PERIODIC, 0x03 = one-shot
      ST [0xF020], R0
`;

describe('hardware interrupts', () => {
  it('the timer interrupt is taken only when unmasked in the PIC and PSW.I = 1', () => {
    const { m } = machine(
      program(
        TIMER_SETUP(50) +
          `
      MOV R0, #0x01
      ST [0xF011], R0      ; PIC mask: line 0
spin1: INC R1
      CMP R1, #40
      JNE spin1            ; I = 0: interrupt must not be taken
      STI
spin2: JMP spin2`,
        DEFAULT_HANDLERS,
      ),
    );
    m.run(2000);
    // At least one interrupt happened after STI, none before.
    const irqs = m.events.toArray().filter((e) => e.type === 'exception' && e.vector === 8);
    expect(irqs.length).toBeGreaterThan(0);
    const sti = m.events.toArray().find((e) => e.type === 'exception')!;
    expect(m.cpu.r[1]).toBe(40);
    expect(sti.vector).toBe(8);
    expect(m.cpu.r[7]).toBe(8);
  });

  it('PIC mask 0 blocks interrupts even with I = 1', () => {
    const { m } = machine(program(TIMER_SETUP(20) + `\nSTI\nspin: JMP spin`, DEFAULT_HANDLERS));
    m.run(1000);
    expect(m.events.toArray().filter((e) => e.type === 'exception')).toHaveLength(0);
    expect(m.timer.expired).toBe(true);
    expect(m.pic.pending() & 1).toBe(1);
  });

  it('lower line numbers win arbitration', () => {
    const { m } = machine(
      program(
        TIMER_SETUP(5, 0x03) +
          `
      MOV R0, #0x01
      ST [0xF042], R0      ; keyboard IE
      MOV R0, #0x03
      ST [0xF011], R0      ; PIC: lines 0 and 1
      NOP
      NOP
      NOP
      STI
spin: JMP spin`,
        DEFAULT_HANDLERS,
      ),
    );
    m.injectKey(0x41);
    m.run(400);
    const vectors = m.events
      .toArray()
      .filter((e) => e.type === 'exception')
      .map((e) => e.vector);
    expect(vectors[0]).toBe(8);
    expect(vectors).toContain(9);
    expect(m.cpu.r[5]).toBe(0x41);
  });

  it('HLT with I = 0 wakes on a pending enabled line and continues after HLT', () => {
    const { m } = machine(
      program(
        TIMER_SETUP(100, 0x03) +
          `
      MOV R0, #0x01
      ST [0xF011], R0
      HLT
      MOV R2, #0x99
done: JMP done`,
        DEFAULT_HANDLERS,
      ),
    );
    m.run(300);
    expect(m.cpu.r[2]).toBe(0x99);
    expect(m.cpu.r[7]).toBe(0); // no handler ran
    expect(m.modeCycles.idle).toBeGreaterThan(50);
  });

  it('HLT with I = 1 takes the interrupt; the saved PC is after HLT', () => {
    const { m, r } = machine(
      program(
        TIMER_SETUP(100) +
          `
      MOV R0, #0x01
      ST [0xF011], R0
      STI
      HLT
resume: MOV R2, #0x42
done: JMP done`,
        DEFAULT_HANDLERS,
      ),
    );
    m.run(500);
    const entry = m.events.toArray().find((e) => e.type === 'exception')!;
    expect(entry.vector).toBe(8);
    expect(entry.fromPc).toBe(sym(r, 'resume'));
    expect(m.cpu.r[2]).toBe(0x42);
  });

  it('run() reports a halted CPU with no enabled interrupt lines', () => {
    const { m } = bareMachine('HLT');
    const res = m.run(100000);
    expect(res.reason).toBe('halted');
    expect(res.cycles).toBeLessThan(20);
  });

  it('nested interrupts are possible when a handler executes STI', () => {
    const { m, r } = machine(
      program(
        TIMER_SETUP(30) +
          `
      MOV R0, #0x03
      ST [0xF011], R0      ; PIC: timer and keyboard lines
      STI
spin: JMP spin`,
        `
h_ill: HLT
h_priv: HLT
h_mem: HLT
h_sys: HLT
h_brk: HLT
h_disk: HLT
h_timer: MOV R6, #1
      ST [0xF021], R6      ; acknowledge timer
      MOV R6, #0
      ST [0xF020], R6      ; stop the timer
      MOV R6, #1
      ST [0xF042], R6      ; enable keyboard interrupts now
      STI                  ; allow nesting
nest: CMP R2, #0
      JEQ nest             ; wait here until the keyboard handler has run
      MOV R3, #0x33
      RTI
h_kbd: LD R5, [0xF040]
      MOV R2, #1
      RTI`,
      ),
    );
    m.injectKey(0x55); // queued; its line is only enabled inside the timer handler
    m.run(3000);
    const ex = m.events.toArray().filter((e) => e.type === 'exception');
    expect(ex.map((e) => e.vector)).toEqual([8, 9]);
    const kbd = ex[1]!;
    // The keyboard interrupt interrupted the timer handler itself.
    expect(kbd.fromPc).toBeGreaterThanOrEqual(sym(r, 'h_timer'));
    expect(kbd.fromPc).toBeLessThan(sym(r, 'h_kbd'));
    expect(m.cpu.r[5]).toBe(0x55);
    expect(m.cpu.r[3]).toBe(0x33);
  });

  it('an interrupt taken in user mode switches to KSP and RTI returns to the user stack', () => {
    const { m, r } = userProgram(
      'MOVP P0, #0x1234\nPUSHP P0\nuloop: INC R1\nJMP uloop',
      DEFAULT_HANDLERS.replace(
        'h_timer: MOV R7, #8',
        'h_timer: MOV R7, #8\n         MOV R6, #0\n         ST [0xF020], R6      ; stop the timer',
      ),
    );
    // Arm a one-shot timer and enable its line before the program starts
    // (test setup through the device interface).
    m.timer.write(2, 0x2c);
    m.timer.write(3, 0x01); // RELOAD = 300
    m.timer.write(0, 0x03); // EN | IE, one-shot
    m.pic.write(1, 0x01);
    m.run(3000);
    const ex = m.events.toArray().filter((e) => e.type === 'exception');
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ vector: 8, cause: 0x20, fromUser: true });
    expect(ex[0]!.fromPc).toBeGreaterThanOrEqual(sym(r, 'uloop'));
    expect(m.cpu.cause).toBe(0x20);
    expect(m.cpu.faddr).toBe(0); // FADDR untouched by non-memory exceptions
    const rti = m.events.toArray().find((e) => e.type === 'rti' && e.cycle > ex[0]!.cycle)!;
    expect(rti.toUser).toBe(true);
    expect(m.cpu.supervisor).toBe(false);
    expect(m.cpu.usp).toBe(0x6ffe); // the PUSHP before the interrupt, nothing else
    expect(m.bus.peekWord(0x6ffe)).toBe(0x1234);
    expect(m.cpu.ksp).toBe(0x3000);
  });

  it('a pending interrupt is taken immediately after RTI sets I, before any further instruction', () => {
    // User code runs with I = 1. The syscall handler (I = 0) waits until the
    // timer line is pending, then returns: the IRQ must be taken at once.
    const { m, r } = userProgram(
      'SYS\nafter: MOV R2, #0x77\nhere: JMP here',
      DEFAULT_HANDLERS.replace(
        'h_sys:   MOV R7, #4\n         RTI',
        `h_sys:   MOV R7, #4
         MOV R0, #10
         ST [0xF022], R0
         MOV R0, #0
         ST [0xF023], R0
         MOV R0, #0x03
         ST [0xF020], R0      ; one-shot timer
         MOV R0, #0x01
         ST [0xF011], R0
.w:      LD R0, [0xF010]
         AND R0, #1
         JEQ .w               ; wait until line 0 is pending (I = 0: not taken)
         RTI`,
      ),
    );
    m.run(3000);
    const evs = m.events.toArray().filter((e) => e.type === 'exception' || e.type === 'rti');
    const rtiIdx = evs.findIndex((e) => e.type === 'rti' && e.toUser && e.pc === sym(r, 'after'));
    expect(rtiIdx).toBeGreaterThan(0);
    const next = evs[rtiIdx + 1]!;
    expect(next).toMatchObject({ type: 'exception', vector: 8, fromPc: sym(r, 'after') });
    expect(next.cycle - evs[rtiIdx]!.cycle).toBe(12); // exactly one exception-entry sequence later
  });

  it('FADDR reports the exact byte when an instruction straddles ULIMIT', () => {
    const { m } = userProgram(`
      JMP 0x7FFE`);
    // Place a 4-byte instruction (MOVP P0, #imm16) at 0x7FFE; bytes 0x8000+ are outside the window.
    m.debugPoke(0x7ffe, 0x19);
    m.debugPoke(0x7fff, 0x00);
    m.run(2000);
    expect(m.cpu.cause).toBe(CAUSE.FETCH_VIOLATION);
    expect(m.cpu.faddr).toBe(0x8000);
    expect(m.bus.peekWord(m.cpu.ksp + 1)).toBe(0x7ffe); // saved PC = first byte of the instruction
  });

  it('FADDR keeps the last memory fault address across later non-memory exceptions', () => {
    const { m } = userProgram('LD R0, [0x2000]');
    m.run(1000);
    expect(m.cpu.faddr).toBe(0x2000);
    // Now a syscall from supervisor code: FADDR must not change.
    m.cpu.status = 'running';
    m.cpu.trap(CAUSE.SYSCALL);
    m.stepInstruction();
    expect(m.cpu.cause).toBe(CAUSE.SYSCALL);
    expect(m.cpu.faddr).toBe(0x2000);
  });
});
