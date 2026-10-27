; =====================================================================
; trap.asm — exception/interrupt entry, context save and restore
;
; On entry the CPU has already (in hardware):
;   switched to the kernel stack (KSP), pushed PC (high, low) and PSW,
;   set PSW.S = 1 and PSW.I = 0, and loaded PC from the vector table.
; Each vector stub saves R0 and records which vector fired; trap_entry
; saves the remaining registers and USP, completing the trap frame:
;
;   SP+0  USP lo   SP+1  USP hi
;   SP+2  R7  SP+3 R6  SP+4 R5  SP+5 R4  SP+6 R3  SP+7 R2  SP+8 R1  SP+9 R0
;   SP+10 PSW (CPU)   SP+11 PC lo (CPU)   SP+12 PC hi (CPU)
; =====================================================================

vec_illegal:
        PUSH R0
        MOV R0, #VEC_ILLEGAL
        JMP trap_entry
vec_privilege:
        PUSH R0
        MOV R0, #VEC_PRIVILEGE
        JMP trap_entry
vec_memory:
        PUSH R0
        MOV R0, #VEC_MEMORY
        JMP trap_entry
vec_syscall:
        PUSH R0
        MOV R0, #VEC_SYSCALL
        JMP trap_entry
vec_break:
        PUSH R0
        MOV R0, #VEC_BREAK
        JMP trap_entry
vec_timer:
        PUSH R0
        MOV R0, #VEC_IRQ0
        JMP trap_entry
vec_keyboard:
        PUSH R0
        MOV R0, #VEC_IRQ1
        JMP trap_entry

; ---------------------------------------------------------------------
; trap_entry: R0 = vector number, original R0 already pushed.
; ---------------------------------------------------------------------
trap_entry:
        PUSH R1                         ; save the interrupted context
        PUSH R2
        PUSH R3
        PUSH R4
        PUSH R5
        PUSH R6
        PUSH R7
        MFC P3, USP                     ; the user stack pointer is banked:
        PUSHP P3                        ; save it explicitly
        STW [kframe], SP                ; remember where the frame is
        ST [kvector], R0

        ; Traps from supervisor mode mean a kernel bug (the kernel never
        ; enables interrupts or executes SYS).
        LD R1, [SP+FR_PSW]
        AND R1, #PSW_S
        JNE kernel_panic

        ; Record the frame in the current process's PCB.
        LD R0, [current]
        CALL pcb_addr                   ; P3 = PCB of the interrupted process
        STW [P3+PCB_KSP], SP

        LD R0, [kvector]
        CMP R0, #VEC_SYSCALL
        JEQ syscall_dispatch
        CMP R0, #VEC_IRQ0
        JEQ timer_interrupt
        CMP R0, #VEC_IRQ1
        JEQ keyboard_interrupt
        JMP process_fault               ; illegal, privilege, memory, BRK

; ---------------------------------------------------------------------
; resume_current: restore the process `current` from its saved frame
; and return to it with RTI. Never returns.
; ---------------------------------------------------------------------
resume_current:
        LD R0, [current]
        CALL pcb_addr
        LDW SP, [P3+PCB_KSP]            ; switch to that process's kernel stack
        LDW P0, [P3+PCB_BASE]
        MTC UBASE, P0                   ; its memory window ...
        LDW P0, [P3+PCB_LIMIT]
        MTC ULIMIT, P0                  ; ... enforced by the CPU in user mode
        POPP P3
        MTC USP, P3                     ; its user stack pointer
        POP R7                          ; its registers
        POP R6
        POP R5
        POP R4
        POP R3
        POP R2
        POP R1
        POP R0
        RTI                             ; PSW (user mode, I=1) and PC from the frame

; ---------------------------------------------------------------------
; Timer interrupt: account the tick, then preempt the running process.
; ---------------------------------------------------------------------
timer_interrupt:
        CALL timer_service              ; acknowledge, count, wake sleepers
        LD R0, [current]
        CALL pcb_addr
        LDW P0, [P3+PCB_TICKS]
        INCP P0
        STW [P3+PCB_TICKS], P0
        LD R0, [P3+PCB_STATE]
        CMP R0, #ST_RUNNING
        JNE schedule
        MOV R0, #ST_READY               ; preempted: back to the ready queue
        ST [P3+PCB_STATE], R0
        JMP schedule

; ---------------------------------------------------------------------
; Keyboard interrupt: move keys into the kernel buffer, wake readers,
; return to the interrupted process.
; ---------------------------------------------------------------------
keyboard_interrupt:
        CALL kbd_service
        JMP resume_current

; ---------------------------------------------------------------------
; A user process faulted (or executed BRK): report and terminate it.
; P3 = PCB of the current process.
; ---------------------------------------------------------------------
process_fault:
        MFC P0, CAUSE
        ST [P3+PCB_FAULT], R1
        MOVP P2, #msg_kernel
        CALL kputs
        CALL kputproc                   ; "pid N 'name'"
        MOVP P2, #msg_killed
        CALL kputs
        MFC P0, CAUSE
        CALL cause_name                 ; P2 = description of CAUSE (R1)
        CALL kputs
        MOVP P2, #msg_atpc
        CALL kputs
        LDW P1, [kframe]
        LDW P0, [P1+FR_PC]
        CALL kputhex16
        LD R0, [kvector]
        CMP R0, #VEC_MEMORY
        JNE .nl
        MOVP P2, #msg_addr
        CALL kputs
        MFC P0, FADDR
        CALL kputhex16
.nl:    CALL kputnl
        LD R0, [current]
        CALL pcb_addr
        MOV R0, #0xFF
        ST [P3+PCB_EXIT], R0
        MOV R0, #ST_EXITED
        ST [P3+PCB_STATE], R0
        JMP schedule

; ---------------------------------------------------------------------
; kernel_panic: an exception while in supervisor mode. Halts.
; ---------------------------------------------------------------------
kernel_panic:
        MOVP P2, #msg_panic
        CALL kputs
        MFC P0, CAUSE
        CALL cause_name
        CALL kputs
        MOVP P2, #msg_atpc
        CALL kputs
        LDW P1, [kframe]
        LDW P0, [P1+FR_PC]
        CALL kputhex16
        MOVP P2, #msg_addr
        CALL kputs
        MFC P0, FADDR
        CALL kputhex16
        CALL kputnl
        JMP halt_system

; cause_name: P2 = string describing CAUSE value R1. Changes R0, P2.
cause_name:
        CMP R1, #CAUSE_BREAK
        JEQ .brk
        CMP R1, #8
        JCC .unknown                    ; R1 >= 8
        MOV R0, R1
        SHL R0                          ; table of words
        MOVP P2, #cause_table
        ADDP P2, R0
        LDW P2, [P2]
        RET
.brk:   MOVP P2, #s_cause_brk
        RET
.unknown:
        MOVP P2, #s_cause_unknown
        RET

cause_table:
        .word s_cause_unknown, s_cause_illegal, s_cause_priv, s_cause_read
        .word s_cause_write, s_cause_fetch, s_cause_rom, s_cause_bus
