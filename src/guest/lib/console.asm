; =====================================================================
; lib/console.asm — terminal helpers for bare-metal programs.
; Include it after your code:   .include "lib/console.asm"
; All routines poll TERM_STATUS and write TERM_DATA directly, so they
; only work in supervisor mode (user mode must use system calls).
; =====================================================================

; con_putc: print R0. Preserves all registers.
con_putc:
        PUSH R1
.wait:  LD R1, [TERM_STATUS]
        AND R1, #TERM_READY
        JEQ .wait
        ST [TERM_DATA], R0
        POP R1
        RET

; con_puts: print the NUL-terminated string at P1. Preserves all registers.
con_puts:
        PUSH R0
        PUSHP P1
.loop:  LD R0, [P1]
        CMP R0, #0
        JEQ .done
        CALL con_putc
        INCP P1
        JMP .loop
.done:  POPP P1
        POP R0
        RET

; con_hex8: print R0 as two hex digits. Preserves all registers.
con_hex8:
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
        JMP con_putc
.num:   ADD R0, #'0'
        JMP con_putc

; con_hex16: print P0 as four hex digits. Preserves all registers.
con_hex16:
        PUSH R0
        CALL con_hex8
        MOV R0, R1
        CALL con_hex8
        POP R0
        RET

; con_dec8: print R0 in decimal. Preserves all registers.
con_dec8:
        PUSH R0
        PUSH R1
        PUSH R2
        MOV R2, #0
        MOV R1, #'0'
.h:     CMP R0, #100
        JCS .hd
        SUB R0, #100
        INC R1
        JMP .h
.hd:    CMP R1, #'0'
        JEQ .t
        CALL .emit
.t:     MOV R1, #'0'
.tl:    CMP R0, #10
        JCS .td
        SUB R0, #10
        INC R1
        JMP .tl
.td:    CMP R2, #0
        JNE .pt
        CMP R1, #'0'
        JEQ .o
.pt:    CALL .emit
.o:     ADD R0, #'0'
        CALL con_putc
        POP R2
        POP R1
        POP R0
        RET
.emit:  PUSH R0
        MOV R0, R1
        CALL con_putc
        POP R0
        MOV R2, #1
        RET
