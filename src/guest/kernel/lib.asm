; =====================================================================
; lib.asm — kernel console helpers
; =====================================================================

; kputs: print the NUL-terminated string at P2. Advances P2; preserves R0.
kputs:
        PUSH R0
.loop:  LD R0, [P2]
        CMP R0, #0
        JEQ .done
        CALL kputc
        INCP P2
        JMP .loop
.done:  POP R0
        RET

; kputnl: print a newline. Preserves all registers.
kputnl:
        PUSH R0
        MOV R0, #10
        CALL kputc
        POP R0
        RET

; kputhex8: print R0 as two hex digits. Preserves all registers.
kputhex8:
        PUSH R0
        PUSH R1
        MOV R1, R0
        SHR R0
        SHR R0
        SHR R0
        SHR R0
        CALL .digit
        MOV R0, R1
        AND R0, #0x0F
        CALL .digit
        POP R1
        POP R0
        RET
.digit: CMP R0, #10
        JCS .num
        ADD R0, #'A' - 10
        JMP kputc
.num:   ADD R0, #'0'
        JMP kputc

; kputhex16: print P0 as four hex digits. Preserves all registers.
kputhex16:
        PUSH R0
        CALL kputhex8
        MOV R0, R1
        CALL kputhex8
        POP R0
        RET

; kputdec8: print R0 in decimal (0-255). Preserves all registers.
kputdec8:
        PUSH R0
        PUSH R1
        PUSH R2
        MOV R2, #0                      ; becomes 1 once a digit is printed
        MOV R1, #'0'
.hund:  CMP R0, #100
        JCS .hdone
        SUB R0, #100
        INC R1
        JMP .hund
.hdone: CMP R1, #'0'
        JEQ .tens
        CALL .emit
.tens:  MOV R1, #'0'
.ten:   CMP R0, #10
        JCS .tdone
        SUB R0, #10
        INC R1
        JMP .ten
.tdone: CMP R2, #0
        JNE .ptens
        CMP R1, #'0'
        JEQ .ones
.ptens: CALL .emit
.ones:  ADD R0, #'0'
        CALL kputc
        POP R2
        POP R1
        POP R0
        RET
.emit:  PUSH R0                         ; print R1, remember that we printed
        MOV R0, R1
        CALL kputc
        POP R0
        MOV R2, #1
        RET
