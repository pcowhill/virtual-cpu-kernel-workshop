; storage-read — programmed I/O with the block-storage controller:
; select block 128, issue READ, poll STATUS until DONE, then copy the 256
; bytes from the DATA port into RAM and print them.
        .include "vc8.inc"
buf     = 0x2200
        .org 0x0000
        .word start
        .org 0x0100
start:  MOVP SP, #0x3000
        MOV R0, #128
        ST [DISK_BLOCK_LO], R0
        MOV R0, #0
        ST [DISK_BLOCK_HI], R0
        MOV R0, #DISK_CMD_READ
        ST [DISK_CMD], R0               ; the controller is now BUSY for 64 cycles
poll:   LD R0, [DISK_STATUS]
        AND R0, #DISK_DONE | DISK_ERROR
        JEQ poll
        AND R0, #DISK_ERROR
        JNE fail
        MOVP P1, #buf
        MOV R4, #0                      ; 256 bytes
copy:   LD R0, [DISK_DATA]              ; each read advances the buffer pointer
        ST [P1], R0
        INCP P1
        DEC R4
        JNE copy
        MOVP P1, #buf
        CALL con_puts
        HLT
fail:   MOVP P1, #m_fail
        CALL con_puts
        HLT
m_fail: .asciz "storage error\n"
        .include "lib/console.asm"
