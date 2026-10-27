; protection-fault — the user window. The supervisor allows user code only
; 0x6000-0x6FFF (UBASE/ULIMIT). The user program then writes to 0x7000;
; the protection unit blocks the store, the CPU enters vector 3 and the
; handler prints CAUSE and FADDR.
        .include "vc8.inc"
        .org 0x0000
        .word start, 0xFFFF, 0xFFFF
        .word on_mem                    ; 3: memory fault
        .org 0x0100
start:  MOVP SP, #0x3000
        MOVP P0, #0x6000
        MTC UBASE, P0
        MOVP P0, #0x7000
        MTC ULIMIT, P0                  ; window = [0x6000, 0x7000)
        MOVP P0, #0x6F00
        MTC USP, P0
        MOVP P0, #user
        PUSHP P0
        MOV R0, #PSW_I
        PUSH R0
        RTI

on_mem: MOVP P1, #m_cause
        CALL con_puts
        MFC P0, CAUSE
        MOV R0, R1
        CALL con_hex8                   ; 0x04 = write violation
        MOVP P1, #m_addr
        CALL con_puts
        MFC P0, FADDR
        CALL con_hex16                  ; 0x7000
        MOV R0, #10
        CALL con_putc
        HLT
m_cause: .asciz "Memory fault: CAUSE=0x"
m_addr:  .asciz " FADDR=0x"

        .include "lib/console.asm"     ; supervisor helpers (in ROM)

        .org 0x6000
user:   MOV R0, #0x55
        ST [0x6800], R0                 ; inside the window: fine
        ST [0x7000], R0                 ; outside: write violation
        JMP user
