; register-arithmetic — 8-bit registers, 16-bit values built from pairs.
; Adds two 16-bit numbers with ADD (low bytes) and ADC (high bytes plus
; the carry), then shows that 5 - 7 is 0xFE: 254 unsigned, -2 signed.
        .include "vc8.inc"
        .org 0x0000
        .word start
        .org 0x0100
start:  MOVP P0, #0x12F0        ; P0 = R0:R1 = 0x12F0
        MOVP P1, #0x0120        ; P1 = R2:R3 = 0x0120
        ADD R1, R3              ; low bytes: 0xF0 + 0x20 = 0x10, carry out = 1
        ADC R0, R2              ; high bytes: 0x12 + 0x01 + carry = 0x14
                                ; P0 is now 0x1410
        MOV R4, #5
        SUB R4, #7              ; 5 - 7 = 0xFE; C = 1 (borrow), N = 1
        MOV R5, R4
        NEG R5                  ; two's complement: -(0xFE) = 0x02
        ADDP P1, P0             ; the CPU can also add pairs directly: 0x0120 + 0x1410
        HLT
