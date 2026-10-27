; =====================================================================
; Workshop Kernel v1.0 for the VC-8 Workshop Machine
;
; Loaded by the boot ROM from block storage into kernel RAM at 0x2000
; and entered in supervisor mode with interrupts disabled.
;
; The kernel provides:
;   * exception and interrupt handling (vector table at kvectors)
;   * system calls (SYS instruction, vector 4) - see syscalls.inc
;   * drivers: terminal, keyboard (IRQ 1), timer (IRQ 0), storage, LEDs
;   * up to MAX_PROCS user processes, each in its own 8 KiB memory slot,
;     isolated with the CPU's UBASE/ULIMIT protection window
;   * timer-driven preemptive round-robin scheduling
;
; Every context switch happens in this code: the CPU only pushes PC and
; PSW on an exception; the kernel saves R0-R7 and USP, records the
; stack pointer in the process control block, and later restores another
; process's registers and executes RTI.
;
; Register naming: P0 = R0:R1, P1 = R2:R3, P2 = R4:R5, P3 = R6:R7.
; Subroutines document which registers they change.
; =====================================================================
        .include "vc8.inc"

KERNEL_BASE     = 0x2000        ; load address of this image
QUANTUM         = 2000          ; timer period (cycles) = scheduling time slice
MAX_PROCS       = 4
SLOT_SIZE_HI    = 0x20          ; user slot size 0x2000 (high byte)

; ---- kernel data (not part of the disk image; cleared at boot) ----
KDATA           = 0x5000
current         = KDATA + 0x00  ; index of the running process, 0xFF = none (idle)
nprocs          = KDATA + 0x01  ; number of processes created at boot
ticks           = KDATA + 0x02  ; word: timer interrupts since boot
kframe          = KDATA + 0x04  ; word: address of the trap frame being handled
kvector         = KDATA + 0x06  ; vector number of the trap being handled
kbd_head        = KDATA + 0x07
kbd_tail        = KDATA + 0x08
kbd_count       = KDATA + 0x09
idle_wakeups    = KDATA + 0x0A  ; word
switches        = KDATA + 0x0C  ; word: number of dispatches
tick_acc        = KDATA + 0x0E  ; word: elapsed cycles of interrupted timer periods
kbd_buf         = KDATA + 0x20  ; KBD_BUF_SIZE bytes
KBD_BUF_SIZE    = 16
proc_table      = KDATA + 0x40  ; MAX_PROCS process control blocks
disk_buf        = KDATA + 0x100 ; 256-byte buffer (boot block)
KDATA_END       = KDATA + 0x200

KSTACKS         = 0x5400        ; per-process kernel stacks, KSTACK_SIZE each
KSTACK_SIZE     = 0x100
KSTACK_IDLE     = 0x5A00        ; stack used while idle
KSTACK_BOOT     = 0x5C00        ; stack used during initialisation

; ---- process control block layout ----
PCB_SIZE        = 32
PCB_PID         = 0             ; process id (1..MAX_PROCS)
PCB_STATE       = 1             ; ST_*
PCB_WAIT        = 2             ; W_* reason when blocked
PCB_EXIT        = 3             ; exit code (0xFF if killed)
PCB_KSP         = 4             ; word: saved kernel SP (points at the trap frame)
PCB_BASE        = 6             ; word: UBASE for this process
PCB_LIMIT       = 8             ; word: ULIMIT for this process
PCB_ENTRY       = 10            ; word: entry point
PCB_SLEEP       = 12            ; ticks left to sleep
PCB_TICKS       = 14            ; word: timer ticks charged to this process
PCB_RUNS        = 16            ; word: times dispatched
PCB_SYSCALLS    = 18            ; word: system calls made
PCB_NAME        = 20            ; 8 bytes
PCB_FAULT       = 28            ; CAUSE that killed the process (0 = none)
PCB_SLOT        = 29            ; memory slot index

ST_FREE         = 0
ST_READY        = 1
ST_RUNNING      = 2
ST_BLOCKED      = 3
ST_EXITED       = 4

W_NONE          = 0
W_KEYBOARD      = 1
W_SLEEP         = 2

; ---- trap frame layout (offsets from the frame pointer = SP after saving) ----
FR_USP          = 0             ; word, saved by the kernel
FR_R7           = 2
FR_R6           = 3
FR_R5           = 4
FR_R4           = 5
FR_R3           = 6
FR_P1           = 6             ; word view of R2:R3 (pointer argument)
FR_R2           = 7
FR_R1           = 8
FR_R0           = 9
FR_PSW          = 10            ; pushed by the CPU
FR_PC           = 11            ; word, pushed by the CPU
FRAME_SIZE      = 13

INITIAL_PSW     = PSW_I         ; user mode, interrupts enabled

        .org KERNEL_BASE
; =====================================================================
; Entry point (the boot ROM jumps here)
; =====================================================================
kernel_entry:
        MOVP SP, #KSTACK_BOOT
        MOVP P0, #kvectors
        MTC VBASE, P0                   ; exceptions now go to the kernel
        CALL kdata_clear
        MOV R0, #0xFF
        ST [current], R0

        MOVP P2, #msg_banner
        CALL kputs
        MOVP P2, #msg_vectors
        CALL kputs
        MOVP P0, #kvectors
        CALL kputhex16
        CALL kputnl

        ; ---- read the boot block to find the user programs ----
        MOVP P0, #0
        MOVP P1, #disk_buf
        CALL disk_read
        CMP R0, #0
        JNE boot_disk_error
        LD R0, [disk_buf + HDR_NPROG]
        CMP R0, #MAX_PROCS + 1
        JCS .count_ok
        MOV R0, #MAX_PROCS
.count_ok:
        ST [nprocs], R0
        MOVP P2, #msg_nprog
        CALL kputs
        CALL kputdec8
        MOVP P2, #msg_programs
        CALL kputs

        MOV R0, #0
.create:
        LD R1, [nprocs]
        CMP R0, R1
        JEQ .created
        PUSH R0
        CALL proc_create
        POP R0
        INC R0
        JMP .create
.created:

        ; ---- program the timer and enable interrupt lines ----
        MOVP P0, #QUANTUM
        ST [TIMER_RELOAD_LO], R1
        ST [TIMER_RELOAD_HI], R0
        MOV R0, #TIMER_EN | TIMER_IE | TIMER_PERIODIC
        ST [TIMER_CTRL], R0
        MOV R0, #KBD_IE
        ST [KBD_CTRL], R0
        MOV R0, #IRQ_TIMER | IRQ_KEYBOARD
        ST [PIC_MASK], R0
        MOVP P2, #msg_quantum
        CALL kputs
        MOVP P0, #QUANTUM
        CALL kputhex16
        MOVP P2, #msg_start
        CALL kputs
        JMP schedule                    ; never returns

boot_disk_error:
        MOVP P2, #msg_bootdisk
        CALL kputs
        JMP halt_system

; kdata_clear: zero KDATA..KDATA_END. Changes P0, R2.
kdata_clear:
        MOVP P0, #KDATA
        MOV R2, #0
.loop:  ST [P0], R2
        INCP P0
        CMPP P0, #KDATA_END
        JNE .loop
        RET

; =====================================================================
; Exception vector table (VBASE points here)
; =====================================================================
kvectors:
        .word 0xFFFF                    ; 0  reset (not used after boot)
        .word vec_illegal               ; 1  illegal instruction
        .word vec_privilege             ; 2  privileged instruction in user mode
        .word vec_memory                ; 3  memory protection fault
        .word vec_syscall               ; 4  SYS
        .word vec_break                 ; 5  BRK
        .word 0xFFFF, 0xFFFF            ; 6-7 reserved
        .word vec_timer                 ; 8  IRQ0 timer
        .word vec_keyboard              ; 9  IRQ1 keyboard
        .word 0xFFFF, 0xFFFF, 0xFFFF    ; 10-12 IRQ2-4 (storage is polled)
        .word 0xFFFF, 0xFFFF, 0xFFFF    ; 13-15 IRQ5-7

        .include "trap.asm"
        .include "sched.asm"
        .include "syscall.asm"
        .include "drivers.asm"
        .include "lib.asm"
        .include "messages.asm"
