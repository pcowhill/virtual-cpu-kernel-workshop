; stack-demo — passing arguments on the stack and reading them with
; SP-relative addressing. The caller pushes two bytes, CALL pushes the
; return address, and the callee finds its arguments above it:
;   [SP+0] return address low   [SP+1] return address high
;   [SP+2] second argument      [SP+3] first argument
        .include "vc8.inc"
        .org 0x0000
        .word start
        .org 0x0100
start:  MOVP SP, #0x3000        ; the stack grows down from 0x3000
        MOV R0, #30
        PUSH R0                 ; first argument
        MOV R0, #12
        PUSH R0                 ; second argument
        CALL add2               ; R0 = 30 + 12
        ADDP SP, #2             ; caller removes the arguments
        MOV R7, R0
        HLT

add2:   LD R0, [SP+3]           ; first argument
        LD R1, [SP+2]           ; second argument
        ADD R0, R1
        RET
