; privileged-fault — user mode may not execute privileged instructions.
; The user program tries CLI; the CPU raises a privilege fault (vector 2)
; and the handler reports the faulting PC from the exception frame.
        .include "vc8.inc"
        .org 0x0000
        .word start, 0xFFFF
        .word on_priv                   ; 2: privilege violation
        .org 0x0100
start:  MOVP SP, #0x3000
        MOVP P0, #0x7000
        MTC USP, P0
        MOVP P0, #user
        PUSHP P0
        MOV R0, #PSW_I
        PUSH R0
        RTI                             ; enter user mode at `user`

on_priv:
        MOVP P1, #msg
        CALL con_puts
        LD R1, [SP+1]                   ; saved PC low byte
        LD R0, [SP+2]                   ; saved PC high byte
        CALL con_hex16
        MOV R0, #10
        CALL con_putc
        HLT
msg:    .asciz "Privilege fault! Faulting instruction at 0x"

        .include "lib/console.asm"     ; supervisor helpers (in ROM)

        .org 0x6000
user:   MOV R2, #1
        CLI                             ; not allowed in user mode
        MOV R2, #2                      ; never reached
        JMP user
