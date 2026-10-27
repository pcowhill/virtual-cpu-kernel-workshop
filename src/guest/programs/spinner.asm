; spinner — pure computation, no system calls at all inside its loop.
; Counts in a 16-bit variable in its own memory. Only the timer
; interrupt can take the CPU away from it. Runs until the counter
; reaches LIMIT, then exits.
        .include "syscalls.inc"
LIMIT   = 0x0800

        .org PROC_BASE
start:  MOVP P2, #0
.loop:  INCP P2
        STW [counter], P2       ; visible progress in memory
        CMPP P2, #LIMIT
        JNE .loop
        MOV R0, #SYS_GETPID
        SYS
        ADD R0, #'0'
        MOV R1, R0
        MOV R0, #SYS_PUTC
        SYS                     ; print our pid when done
        MOV R0, #SYS_EXIT
        MOV R1, #0
        SYS

counter: .word 0
