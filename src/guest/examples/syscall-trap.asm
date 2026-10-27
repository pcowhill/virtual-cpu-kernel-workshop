; syscall-trap — a tiny "kernel" and a user program in one file.
; The supervisor code installs a SYS handler, drops to user mode with RTI,
; and the user program asks the handler to print characters. User code
; cannot touch the terminal itself: the SYS trap switches to supervisor
; mode (vector 4) and RTI switches back.
        .include "vc8.inc"
        .org 0x0000
        .word start, 0xFFFF, 0xFFFF, 0xFFFF
        .word on_sys                    ; 4: SYS
        .org 0x0100
start:  MOVP SP, #0x3000                ; kernel stack
        MOVP P0, #0x7000
        MTC USP, P0                     ; user stack
        MOVP P0, #user
        PUSHP P0                        ; build a frame: PC = user ...
        MOV R0, #PSW_I
        PUSH R0                         ; ... PSW = user mode, interrupts on
        RTI                             ; "return" into user mode

; SYS handler: R1 = character to print, R0 = 0 to stop the machine.
on_sys: CMP R0, #0
        JEQ .stop
        MOV R0, R1
        CALL con_putc
        RTI                             ; back to user mode, after the SYS
.stop:  HLT

        .include "lib/console.asm"     ; supervisor helpers (in ROM)

        .org 0x6000                     ; user RAM (loaded by the programmer)
user:   MOVP P1, #text
.next:  LD R1, [P1]
        CMP R1, #0
        JEQ .end
        MOV R0, #1
        SYS                             ; trap to the supervisor
        INCP P1
        JMP .next
.end:   MOV R0, #0
        SYS
text:   .asciz "Printed by user code through SYS\n"
