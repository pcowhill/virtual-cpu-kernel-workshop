; memory-copy — copies a string from ROM into RAM with two pointers and a
; loop, then prints the copy. Watch the destination fill in the Memory lab
; (set a write watchpoint on 0x2100).
        .include "vc8.inc"
dest    = 0x2100
        .org 0x0000
        .word start
        .org 0x0100
start:  MOVP SP, #0x3000
        MOVP P1, #source        ; P1 = source pointer
        MOVP P2, #dest          ; P2 = destination pointer
copy:   LD R0, [P1]             ; register-indirect load
        ST [P2], R0             ; register-indirect store
        INCP P1
        INCP P2
        CMP R0, #0              ; copied the terminating NUL?
        JNE copy
        MOVP P1, #dest
        CALL con_puts           ; print the copy from RAM
        HLT
source: .asciz "This string was copied from ROM to RAM 0x2100.\n"
        .include "lib/console.asm"
