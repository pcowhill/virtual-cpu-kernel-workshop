; digits — prints 0-9 five times. Runs alongside alpha to show
; timer-driven interleaving of two independent processes.
        .include "syscalls.inc"
DELAY   = 40

        .org PROC_BASE
start:  MOV R4, #5
.round: MOV R5, #'0'
.next:  MOV R0, #SYS_PUTC
        MOV R1, R5
        SYS
        CALL delay
        INC R5
        CMP R5, #'9' + 1
        JNE .next
        DEC R4
        JNE .round
        MOV R0, #SYS_EXIT
        MOV R1, #0
        SYS

delay:  MOV R6, #DELAY
.spin:  DEC R6
        JNE .spin
        RET
