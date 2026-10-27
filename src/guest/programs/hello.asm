; hello — the first user program: prints a greeting with its pid using
; the puts and putc system calls, then exits.
        .include "syscalls.inc"

        .org PROC_BASE
start:  MOVP P1, #greeting
        MOV R0, #SYS_PUTS
        SYS                     ; trap into the kernel, which prints for us
        MOV R0, #SYS_GETPID
        SYS                     ; R0 = our pid
        ADD R0, #'0'
        MOV R1, R0
        MOV R0, #SYS_PUTC
        SYS
        MOV R0, #SYS_PUTC
        MOV R1, #10
        SYS
        MOV R0, #SYS_EXIT
        MOV R1, #0
        SYS

greeting: .asciz "Hello from user mode! I am pid "
