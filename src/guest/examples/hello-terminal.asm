; hello-terminal — memory-mapped output: every character is a store to the
; terminal's DATA register at 0xF030, after checking its STATUS register.
        .include "vc8.inc"
        .org 0x0000
        .word start
        .org 0x0100
start:  MOVP P1, #msg
loop:   LD R0, [P1]
        CMP R0, #0
        JEQ done
wait:   LD R1, [TERM_STATUS]    ; is the terminal ready?
        AND R1, #TERM_READY
        JEQ wait
        ST [TERM_DATA], R0      ; this store *is* the output
        INCP P1
        JMP loop
done:   HLT
msg:    .asciz "Hello, world! (from a bare-metal VC-8 program)\n"
