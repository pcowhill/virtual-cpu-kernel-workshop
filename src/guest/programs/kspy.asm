; kspy — tries to read the kernel's process table directly.
; User mode may only touch its own window, so this is a read violation.
        .include "syscalls.inc"

        .org PROC_BASE
start:  LD R0, [0x5040]         ; kernel RAM
        MOV R0, #SYS_EXIT
        MOV R1, #0
        SYS
