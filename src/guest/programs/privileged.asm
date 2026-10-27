; privileged — tries to widen its own memory window with MTC, which is a
; privileged instruction. The CPU raises a privilege fault (vector 2).
        .include "syscalls.inc"

        .org PROC_BASE
start:  MOVP P0, #0xF000
        MTC ULIMIT, P0          ; privileged: only the kernel may do this
        MOV R0, #SYS_EXIT
        MOV R1, #0
        SYS
