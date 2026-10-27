; recursion — fib(n) computed recursively; every call keeps its state on
; the stack, so the stack grows and shrinks as the recursion unfolds.
; fib(10) = 55 (0x37) ends up in R0.
        .include "vc8.inc"
        .org 0x0000
        .word start
        .org 0x0100
start:  MOVP SP, #0x3000
        MOV R0, #10
        CALL fib
        ST [0x2000], R0
        HLT

; fib: R0 = fib(R0) for small n. Uses R1 and the stack.
fib:    CMP R0, #2
        JCS .base               ; n < 2: fib(n) = n
        PUSH R0                 ; save n
        DEC R0
        CALL fib                ; R0 = fib(n-1)
        POP R1                  ; R1 = n
        PUSH R0                 ; save fib(n-1)
        MOV R0, R1
        SUB R0, #2
        CALL fib                ; R0 = fib(n-2)
        POP R1                  ; R1 = fib(n-1)
        ADD R0, R1
.base:  RET
