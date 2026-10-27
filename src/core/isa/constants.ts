/**
 * Architectural constants of the VC-8 Workshop Machine.
 * Normative source: docs/spec/architecture.md (spec version 1.0).
 */

export const SPEC_VERSION = '1.0';

/** PSW bit masks. */
export const PSW = {
  C: 0x01,
  Z: 0x02,
  N: 0x04,
  V: 0x08,
  I: 0x40,
  S: 0x80,
} as const;

/** Bits of the PSW that exist; reserved bits 4–5 always read as zero. */
export const PSW_WRITABLE_MASK = 0xcf;
export const FLAG_MASK = 0x0f;
export const PSW_RESET = PSW.S;

/** Control-register numbers (MFC/MTC field values). */
export const CR = {
  PSW: 0,
  USP: 1,
  VBASE: 2,
  UBASE: 3,
  ULIMIT: 4,
  CAUSE: 5,
  FADDR: 6,
  KSCRATCH: 7,
} as const;
export type ControlRegisterName = keyof typeof CR;
export const CR_NAMES: readonly ControlRegisterName[] = [
  'PSW',
  'USP',
  'VBASE',
  'UBASE',
  'ULIMIT',
  'CAUSE',
  'FADDR',
  'KSCRATCH',
];

/** Exception vectors. */
export const VECTOR = {
  RESET: 0,
  ILLEGAL: 1,
  PRIVILEGE: 2,
  MEMORY: 3,
  SYSCALL: 4,
  BREAK: 5,
  IRQ_BASE: 8,
} as const;
export const VECTOR_COUNT = 16;
export const VECTOR_NAMES: readonly string[] = [
  'RESET',
  'ILLEGAL',
  'PRIVILEGE',
  'MEMORY',
  'SYSCALL',
  'BREAK',
  'RESERVED6',
  'RESERVED7',
  'IRQ0 (timer)',
  'IRQ1 (keyboard)',
  'IRQ2 (storage)',
  'IRQ3',
  'IRQ4',
  'IRQ5',
  'IRQ6',
  'IRQ7',
];
/** A vector entry with this value means "no handler installed". */
export const VECTOR_ABSENT = 0xffff;

/** Values of the CAUSE control register. */
export const CAUSE = {
  NONE: 0x00,
  ILLEGAL_INSTRUCTION: 0x01,
  PRIVILEGED_INSTRUCTION: 0x02,
  READ_VIOLATION: 0x03,
  WRITE_VIOLATION: 0x04,
  FETCH_VIOLATION: 0x05,
  ROM_WRITE: 0x06,
  BUS_ERROR: 0x07,
  SYSCALL: 0x10,
  BREAKPOINT: 0x11,
  IRQ_BASE: 0x20,
} as const;

export function causeName(code: number): string {
  switch (code) {
    case CAUSE.NONE:
      return 'NONE';
    case CAUSE.ILLEGAL_INSTRUCTION:
      return 'ILLEGAL_INSTRUCTION';
    case CAUSE.PRIVILEGED_INSTRUCTION:
      return 'PRIVILEGED_INSTRUCTION';
    case CAUSE.READ_VIOLATION:
      return 'READ_VIOLATION';
    case CAUSE.WRITE_VIOLATION:
      return 'WRITE_VIOLATION';
    case CAUSE.FETCH_VIOLATION:
      return 'FETCH_VIOLATION';
    case CAUSE.ROM_WRITE:
      return 'ROM_WRITE';
    case CAUSE.BUS_ERROR:
      return 'BUS_ERROR';
    case CAUSE.SYSCALL:
      return 'SYSCALL';
    case CAUSE.BREAKPOINT:
      return 'BREAKPOINT';
    default:
      if (code >= CAUSE.IRQ_BASE && code < CAUSE.IRQ_BASE + 8) return `IRQ${code - CAUSE.IRQ_BASE}`;
      return `UNKNOWN_0x${code.toString(16).padStart(2, '0')}`;
  }
}

/** Memory map. All ranges are inclusive. */
export const MEM = {
  ROM_START: 0x0000,
  ROM_END: 0x1fff,
  KRAM_START: 0x2000,
  KRAM_END: 0x5fff,
  URAM_START: 0x6000,
  URAM_END: 0xefff,
  MMIO_START: 0xf000,
  MMIO_END: 0xffff,
  SIZE: 0x10000,
} as const;

export type RegionId = 'rom' | 'kernel' | 'user' | 'mmio';

export function regionOf(addr: number): RegionId {
  if (addr <= MEM.ROM_END) return 'rom';
  if (addr <= MEM.KRAM_END) return 'kernel';
  if (addr <= MEM.URAM_END) return 'user';
  return 'mmio';
}

export const REGION_INFO: Record<RegionId, { name: string; start: number; end: number }> = {
  rom: { name: 'Boot ROM', start: MEM.ROM_START, end: MEM.ROM_END },
  kernel: { name: 'Kernel RAM', start: MEM.KRAM_START, end: MEM.KRAM_END },
  user: { name: 'User RAM', start: MEM.URAM_START, end: MEM.URAM_END },
  mmio: { name: 'Memory-mapped I/O', start: MEM.MMIO_START, end: MEM.MMIO_END },
};

/** Reset values of control registers. */
export const RESET_UBASE = 0x6000;
export const RESET_ULIMIT = 0xf000;

/** Memory-mapped device register addresses. */
export const IO = {
  SYS_ID: 0xf000,
  SYS_VERSION: 0xf001,
  SYS_POWER: 0xf002,
  SYS_CYCLES0: 0xf004,
  SYS_CYCLES1: 0xf005,
  SYS_CYCLES2: 0xf006,
  SYS_CYCLES3: 0xf007,

  PIC_PENDING: 0xf010,
  PIC_MASK: 0xf011,

  TIMER_CTRL: 0xf020,
  TIMER_STATUS: 0xf021,
  TIMER_RELOAD_LO: 0xf022,
  TIMER_RELOAD_HI: 0xf023,
  TIMER_COUNT_LO: 0xf024,
  TIMER_COUNT_HI: 0xf025,

  TERM_DATA: 0xf030,
  TERM_STATUS: 0xf031,
  TERM_CTRL: 0xf032,

  KBD_DATA: 0xf040,
  KBD_STATUS: 0xf041,
  KBD_CTRL: 0xf042,
  KBD_COUNT: 0xf043,

  GPIO_LEDS: 0xf050,
  GPIO_SWITCHES: 0xf051,

  DISK_CMD: 0xf060,
  DISK_STATUS: 0xf061,
  DISK_BLOCK_LO: 0xf062,
  DISK_BLOCK_HI: 0xf063,
  DISK_DATA: 0xf064,
  DISK_ERRCODE: 0xf065,
  DISK_CTRL: 0xf066,
  DISK_BLOCKS: 0xf067,
} as const;

export const IRQ_LINE = {
  TIMER: 0,
  KEYBOARD: 1,
  STORAGE: 2,
} as const;

export const POWER_OFF_MAGIC = 0xa5;
export const SYS_ID_VALUE = 0x56;
export const SYS_VERSION_VALUE = 0x10;

export const DISK_BLOCK_SIZE = 256;
export const DISK_BLOCK_COUNT = 256;
export const DISK_LATENCY_CYCLES = 64;
export const KBD_QUEUE_CAPACITY = 16;
export const TERM_COLS = 80;
export const TERM_ROWS = 24;
