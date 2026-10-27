; =====================================================================
; vc8.inc — VC-8 Workshop Machine hardware definitions (spec v1.0)
; Memory map, device registers and bit masks for firmware, kernel and
; bare-metal programs. User programs normally include syscalls.inc instead.
; =====================================================================

; ---- memory map ----
ROM_START       = 0x0000
ROM_END         = 0x1FFF
KRAM_START      = 0x2000
KRAM_END        = 0x5FFF
URAM_START      = 0x6000
URAM_END        = 0xEFFF
MMIO_START      = 0xF000

; ---- PSW bits ----
PSW_C           = 0x01
PSW_Z           = 0x02
PSW_N           = 0x04
PSW_V           = 0x08
PSW_I           = 0x40
PSW_S           = 0x80

; ---- exception vectors (index into the table at VBASE) ----
VEC_RESET       = 0
VEC_ILLEGAL     = 1
VEC_PRIVILEGE   = 2
VEC_MEMORY      = 3
VEC_SYSCALL     = 4
VEC_BREAK       = 5
VEC_IRQ0        = 8
VEC_IRQ1        = 9
VEC_IRQ2        = 10

; ---- CAUSE register values ----
CAUSE_ILLEGAL   = 0x01
CAUSE_PRIV      = 0x02
CAUSE_READ      = 0x03
CAUSE_WRITE     = 0x04
CAUSE_FETCH     = 0x05
CAUSE_ROMWRITE  = 0x06
CAUSE_BUS       = 0x07
CAUSE_SYSCALL   = 0x10
CAUSE_BREAK     = 0x11

; ---- system control ----
SYS_ID          = 0xF000
SYS_VERSION     = 0xF001
SYS_POWER       = 0xF002
SYS_CYCLES0     = 0xF004
POWER_OFF_MAGIC = 0xA5

; ---- interrupt controller ----
PIC_PENDING     = 0xF010
PIC_MASK        = 0xF011
IRQ_TIMER       = 0x01          ; line 0
IRQ_KEYBOARD    = 0x02          ; line 1
IRQ_STORAGE     = 0x04          ; line 2

; ---- timer ----
TIMER_CTRL      = 0xF020
TIMER_STATUS    = 0xF021
TIMER_RELOAD_LO = 0xF022
TIMER_RELOAD_HI = 0xF023
TIMER_COUNT_LO  = 0xF024
TIMER_COUNT_HI  = 0xF025
TIMER_EN        = 0x01
TIMER_IE        = 0x02
TIMER_PERIODIC  = 0x04
TIMER_EXPIRED   = 0x01

; ---- terminal ----
TERM_DATA       = 0xF030
TERM_STATUS     = 0xF031
TERM_CTRL       = 0xF032
TERM_READY      = 0x01
TERM_CLEAR      = 0x01

; ---- keyboard ----
KBD_DATA        = 0xF040
KBD_STATUS      = 0xF041
KBD_CTRL        = 0xF042
KBD_COUNT       = 0xF043
KBD_AVAIL       = 0x01
KBD_OVERFLOW    = 0x02
KBD_IE          = 0x01

; ---- LEDs / GPIO ----
GPIO_LEDS       = 0xF050
GPIO_SWITCHES   = 0xF051

; ---- block storage ----
DISK_CMD        = 0xF060
DISK_STATUS     = 0xF061
DISK_BLOCK_LO   = 0xF062
DISK_BLOCK_HI   = 0xF063
DISK_DATA       = 0xF064
DISK_ERRCODE    = 0xF065
DISK_CTRL       = 0xF066
DISK_BLOCKS     = 0xF067
DISK_CMD_READ   = 0x01
DISK_CMD_WRITE  = 0x02
DISK_CMD_REWIND = 0x03
DISK_BUSY       = 0x01
DISK_DONE       = 0x02
DISK_ERROR      = 0x04
DISK_BLOCK_SIZE = 256

; ---- boot disk format (block 0) ----
BOOT_MAGIC0     = 'V'
BOOT_MAGIC1     = 'K'
BOOT_VERSION    = 1
HDR_MAGIC       = 0             ; 2 bytes "VK"
HDR_VERSION     = 2
HDR_KBLOCK      = 3             ; first kernel block
HDR_KCOUNT      = 4             ; kernel block count
HDR_KLOAD       = 5             ; kernel load address (word)
HDR_KENTRY      = 7             ; kernel entry point (word)
HDR_KSUM        = 9             ; 8-bit sum of all kernel block bytes
HDR_NPROG       = 10            ; number of program entries
HDR_PROGS       = 16            ; first program entry
PROG_ENTRY_SIZE = 16
PE_NAME         = 0             ; 8 bytes, NUL padded
PE_BLOCK        = 8
PE_COUNT        = 9
PE_LOAD         = 10            ; word
PE_ENTRY        = 12            ; word
PE_SLOT         = 14
