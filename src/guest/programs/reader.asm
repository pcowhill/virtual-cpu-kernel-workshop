; reader — reads block 128 of the storage device through the readblk
; system call (the kernel's storage driver does the I/O) and prints it.
        .include "syscalls.inc"
DATA_BLOCK = 128

        .org PROC_BASE
start:  MOV R0, #SYS_READBLK
        MOV R1, #DATA_BLOCK
        MOVP P1, #buffer
        SYS
        CMP R1, #E_OK
        JNE .fail
        MOVP P1, #buffer
        MOV R0, #SYS_PUTS
        SYS
        MOV R0, #SYS_EXIT
        MOV R1, #0
        SYS
.fail:  MOV R0, #SYS_EXIT
        MOV R1, #3
        SYS
buffer: .space 256
