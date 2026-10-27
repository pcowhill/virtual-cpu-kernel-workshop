; regcheck — verifies that the kernel preserves every register and the
; stack across preemptions. Each round loads R0-R7 with a pattern that
; depends on the pid, runs a long stretch of NOPs (so timer interrupts
; and context switches happen while the pattern is live), stores the
; registers to memory and checks them. Exit code 0 = all preserved.
        .include "syscalls.inc"
ROUNDS  = 24

        .org PROC_BASE
start:  MOV R0, #SYS_GETPID
        SYS
        SHL R0
        SHL R0
        SHL R0
        SHL R0                  ; seed = pid * 16
        ST [seed], R0
        MOV R1, #0xC3
        PUSH R1                 ; stack canaries
        PUSH R0
        MOV R0, #ROUNDS
        ST [rounds], R0
.round: LD R0, [seed]           ; R0..R7 = seed, seed+1, ..., seed+7
        MOV R1, R0
        INC R1
        MOV R2, R1
        INC R2
        MOV R3, R2
        INC R3
        MOV R4, R3
        INC R4
        MOV R5, R4
        INC R5
        MOV R6, R5
        INC R6
        MOV R7, R6
        INC R7
        .fill 300, 0x01          ; 300 NOPs (opcode 0x01): the timer interrupt lands in here
        ST [observed+0], R0     ; ST does not change any register
        ST [observed+1], R1
        ST [observed+2], R2
        ST [observed+3], R3
        ST [observed+4], R4
        ST [observed+5], R5
        ST [observed+6], R6
        ST [observed+7], R7
        LD R0, [seed]
        MOVP P1, #observed
        MOV R4, #8
.check: LD R5, [P1]
        CMP R5, R0
        JNE fail
        INC R0
        INCP P1
        DEC R4
        JNE .check
        LD R0, [rounds]
        DEC R0
        ST [rounds], R0
        JNE .round
        POP R0                  ; canaries
        LD R1, [seed]
        CMP R0, R1
        JNE fail
        POP R0
        CMP R0, #0xC3
        JNE fail
        MOV R0, #SYS_EXIT
        MOV R1, #0
        SYS
fail:   MOV R0, #SYS_EXIT
        MOV R1, #1
        SYS

seed:     .byte 0
rounds:   .byte 0
observed: .space 8
