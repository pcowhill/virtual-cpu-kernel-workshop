; keyboard-echo — polling input: wait until the keyboard's STATUS says a
; key is available, read DATA (which removes it from the FIFO) and echo it
; in upper case. Type in the terminal; '.' stops the program.
        .include "vc8.inc"
        .org 0x0000
        .word start
        .org 0x0100
start:  MOVP SP, #0x3000
        MOVP P1, #prompt
        CALL con_puts
poll:   LD R0, [KBD_STATUS]
        AND R0, #KBD_AVAIL
        JEQ poll                ; busy-wait: no interrupts used here
        LD R0, [KBD_DATA]       ; dequeue the key
        CMP R0, #'a'
        JCS .out
        CMP R0, #'z' + 1
        JCC .out
        SUB R0, #0x20
.out:   CALL con_putc
        CMP R0, #'.'
        JNE poll
        HLT
prompt: .asciz "Type letters (. to stop): "
        .include "lib/console.asm"
