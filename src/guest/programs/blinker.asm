; blinker — walks a light across the LEDs using the setled and sleep
; system calls. sleep blocks the process until enough timer ticks pass.
        .include "syscalls.inc"

        .org PROC_BASE
start:  MOV R4, #16             ; steps
        MOV R5, #0x01           ; pattern
.step:  MOV R0, #SYS_SETLED
        MOV R1, R5
        SYS
        MOV R0, #SYS_SLEEP
        MOV R1, #2              ; two timer ticks
        SYS
        SHL R5
        JNE .same
        MOV R5, #0x01
.same:  DEC R4
        JNE .step
        MOV R0, #SYS_SETLED
        MOV R1, #0
        SYS
        MOV R0, #SYS_EXIT
        MOV R1, #0
        SYS
