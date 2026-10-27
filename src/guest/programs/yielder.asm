; yielder — a polite, busy poller: checks for a key and immediately
; yields, many times. It enters the kernel far more often than the timer
; period; the kernel's timekeeping (and therefore every sleeping process)
; must not be disturbed by that.
        .include "syscalls.inc"
ROUNDS  = 600

        .org PROC_BASE
start:  MOVP P2, #ROUNDS
.poll:  MOV R0, #SYS_KBHIT
        SYS
        MOV R0, #SYS_YIELD
        SYS
        DECP P2
        JNE .poll
        MOV R0, #SYS_EXIT
        MOV R1, #0
        SYS
