; alpha — prints the alphabet twice, one letter at a time.
; It never yields: the kernel's timer interrupt preempts it.
        .include "syscalls.inc"
DELAY   = 40                    ; busy-wait between letters

        .org PROC_BASE
start:  MOV R4, #2              ; rounds
.round: MOV R5, #'a'
.next:  MOV R0, #SYS_PUTC
        MOV R1, R5
        SYS
        CALL delay
        INC R5
        CMP R5, #'z' + 1
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
