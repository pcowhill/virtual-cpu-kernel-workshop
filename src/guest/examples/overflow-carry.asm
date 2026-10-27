; overflow-carry — the difference between carry (unsigned overflow) and
; V (signed overflow). After each operation the flags are copied from the
; PSW into RAM at 0x2000.. so you can compare them afterwards.
        .include "vc8.inc"
flags   = 0x2000
        .org 0x0000
        .word start
        .org 0x0100
start:  MOV R0, #0x7F
        ADD R0, #1              ; 127 + 1 = 128: signed overflow (V=1), N=1, no carry
        CALL save               ; -> 0x2000
        MOV R0, #0xFF
        ADD R0, #1              ; 255 + 1 = 0: unsigned carry (C=1), Z=1, no overflow
        CALL save               ; -> 0x2001
        MOV R0, #0x80
        SUB R0, #1              ; -128 - 1 = +127: signed overflow (V=1)
        CALL save               ; -> 0x2002
        MOV R0, #0x10
        SUB R0, #0x20           ; 16 - 32: borrow (C=1), result negative (N=1)
        CALL save               ; -> 0x2003
        HLT

; save: append the current flags (PSW low nibble: V N Z C) to the table.
save:   MFC P3, PSW             ; R7 = PSW (supervisor-only instruction)
        AND R7, #0x0F           ; keep C, Z, N, V
        LD R6, [count]
        MOVP P2, #flags
        ADDP P2, R6
        ST [P2], R7
        INC R6
        ST [count], R6
        RET
count   = 0x20F0
