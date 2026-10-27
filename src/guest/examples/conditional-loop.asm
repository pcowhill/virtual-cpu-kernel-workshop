; conditional-loop — signed versus unsigned comparisons.
; Counts how many table entries are greater than 50, once treating the
; bytes as unsigned (JGTU) and once as signed (JGT). 200 is 200 unsigned
; but -56 signed.  R0 = unsigned count, R1 = signed count.
        .include "vc8.inc"
        .org 0x0000
        .word start
        .org 0x0100
start:  MOV R0, #0              ; unsigned count
        MOV R1, #0              ; signed count
        MOVP P1, #table         ; P1 points at the next entry
        MOV R4, #COUNT          ; entries left
next:   LD R5, [P1]
        CMP R5, #50
        JLEU .notu              ; unsigned <= 50 ?
        INC R0
.notu:  CMP R5, #50
        JLE .nots               ; signed <= 50 ?
        INC R1
.nots:  INCP P1
        DEC R4
        JNE next
        HLT
table:  .byte 10, 60, 200, 50, 99
COUNT   = $ - table
