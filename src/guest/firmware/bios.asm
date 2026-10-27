; =====================================================================
; bios.asm — VC-8 Workshop Machine boot firmware (Boot ROM, 0x0000-0x1FFF)
;
; Responsibilities, all performed by these instructions on the virtual CPU:
;   1. Set up a stack and the terminal.
;   2. Check the machine ID register.
;   3. Probe the block-storage device.
;   4. Read and validate the boot block (block 0).
;   5. Copy the kernel image from storage into kernel RAM, byte by byte,
;      through the storage DATA port (programmed I/O), checksumming it.
;   6. Jump to the kernel entry point in supervisor mode, interrupts off.
;
; Register use in this file: P0 = R0:R1, P1 = R2:R3, P2 = R4:R5, P3 = R6:R7.
; =====================================================================
        .include "vc8.inc"

FW_STACK_TOP    = 0x6000        ; firmware stack grows down from the top of kernel RAM
FW_VARS         = 0x5F00        ; firmware variables (kernel RAM; the kernel reuses it later)
fw_kblock       = FW_VARS + 0   ; first kernel block
fw_kcount       = FW_VARS + 1   ; kernel block count
fw_kload        = FW_VARS + 2   ; kernel load address (word)
fw_kentry       = FW_VARS + 4   ; kernel entry point (word)
fw_ksum         = FW_VARS + 6   ; expected checksum

; ---------------------------------------------------------------------
; Vector table. VBASE is 0x0000 after reset, so entry 0 is the reset
; vector. The other entries catch exceptions that happen during boot.
; ---------------------------------------------------------------------
        .org 0x0000
fw_vectors:
        .word fw_reset                                  ; 0  reset
        .word fw_unexpected                             ; 1  illegal instruction
        .word fw_unexpected                             ; 2  privilege violation
        .word fw_unexpected                             ; 3  memory fault
        .word fw_unexpected                             ; 4  system call
        .word fw_unexpected                             ; 5  breakpoint
        .word 0xFFFF, 0xFFFF                            ; 6-7 reserved
        .word fw_unexpected, fw_unexpected              ; IRQ0-1
        .word fw_unexpected, fw_unexpected              ; IRQ2-3
        .word fw_unexpected, fw_unexpected              ; IRQ4-5
        .word fw_unexpected, fw_unexpected              ; IRQ6-7

        .org 0x0040
; =====================================================================
; Reset entry point
; =====================================================================
fw_reset:
        MOVP SP, #FW_STACK_TOP
        MOV R0, #TERM_CLEAR
        ST [TERM_CTRL], R0              ; clear the terminal
        MOVP P2, #msg_banner
        CALL fw_puts

        ; ---- 1. machine identification ----
        LD R0, [SYS_ID]
        CMP R0, #'V'
        JNE fw_bad_machine

        ; ---- 2. probe the storage controller ----
        MOVP P2, #msg_probe
        CALL fw_puts
        MOV R0, #DISK_CMD_REWIND
        ST [DISK_CMD], R0               ; harmless command: resets the buffer pointer
        LD R0, [DISK_ERRCODE]
        CMP R0, #0
        JNE fw_disk_error
        LD R0, [DISK_BLOCKS]            ; capacity in blocks (0 means 256)
        CMP R0, #0
        JNE .small
        MOVP P2, #msg_256
        CALL fw_puts
        JMP .probed
.small: CALL fw_puthex8
        MOVP P2, #msg_blocks
        CALL fw_puts
.probed:

        ; ---- 3. read and validate the boot block ----
        MOVP P2, #msg_bootblk
        CALL fw_puts
        MOVP P0, #0
        CALL fw_disk_read               ; block 0 -> controller buffer
        CMP R0, #0
        JNE fw_disk_error
        LD R0, [DISK_DATA]              ; HDR_MAGIC
        CMP R0, #BOOT_MAGIC0
        JNE fw_no_os
        LD R0, [DISK_DATA]
        CMP R0, #BOOT_MAGIC1
        JNE fw_no_os
        LD R0, [DISK_DATA]              ; HDR_VERSION
        CMP R0, #BOOT_VERSION
        JNE fw_no_os
        LD R0, [DISK_DATA]              ; HDR_KBLOCK
        ST [fw_kblock], R0
        LD R0, [DISK_DATA]              ; HDR_KCOUNT
        ST [fw_kcount], R0
        LD R0, [DISK_DATA]              ; HDR_KLOAD (low, high)
        ST [fw_kload], R0
        LD R0, [DISK_DATA]
        ST [fw_kload+1], R0
        LD R0, [DISK_DATA]              ; HDR_KENTRY (low, high)
        ST [fw_kentry], R0
        LD R0, [DISK_DATA]
        ST [fw_kentry+1], R0
        LD R0, [DISK_DATA]              ; HDR_KSUM
        ST [fw_ksum], R0
        ; ---- sanity-check the kernel layout described by the header ----
        LD R0, [fw_kcount]
        CMP R0, #0
        JEQ fw_no_os                    ; empty kernel
        LD R0, [fw_kblock]
        CMP R0, #0
        JEQ fw_bad_layout               ; block 0 is the boot block itself
        LD R1, [fw_kcount]
        ADD R0, R1
        JCS fw_bad_layout               ; first block + count runs off the disk
        LD R0, [fw_kload]
        CMP R0, #0
        JNE fw_bad_layout               ; load address must be 256-byte aligned
        LD R0, [fw_kload+1]
        CMP R0, #KRAM_START >> 8
        JCS fw_bad_layout               ; below kernel RAM
        ADD R0, R1                      ; R0 = high byte of the end address
        JCS fw_bad_layout
        CMP R0, #FW_VARS >> 8
        JGTU fw_bad_layout              ; would overwrite our variables and stack
        LDW P0, [fw_kentry]             ; entry must lie inside the image
        LDW P1, [fw_kload]
        CMPP P0, P1
        JCS fw_bad_layout
        LD R4, [fw_kcount]
        ADD R2, R4                      ; P1 = end of the image
        CMPP P0, P1
        JCC fw_bad_layout

        MOVP P2, #msg_kimage
        CALL fw_puts
        LD R0, [fw_kcount]
        CALL fw_puthex8
        MOVP P2, #msg_kblocks
        CALL fw_puts
        LDW P0, [fw_kload]
        CALL fw_puthex16
        MOVP P2, #msg_newline
        CALL fw_puts

        ; ---- 4. copy the kernel into RAM (programmed I/O) ----
        MOVP P2, #msg_loading
        CALL fw_puts
        LDW P1, [fw_kload]              ; P1 = destination pointer
        MOV R5, #0                      ; R5 = running checksum
        LD R6, [fw_kblock]              ; R6 = current block number
        LD R7, [fw_kcount]              ; R7 = blocks remaining
.block: MOV R0, #0
        MOV R1, R6                      ; P0 = block number
        CALL fw_disk_read
        CMP R0, #0
        JNE fw_disk_error
        MOV R4, #0                      ; 256 iterations (0 wraps to 255 ... 0)
.copy:  LD R0, [DISK_DATA]              ; next byte from the controller buffer
        ST [P1], R0                     ; ... into kernel RAM
        ADD R5, R0
        INCP P1
        DEC R4
        JNE .copy
        MOV R0, #'.'
        CALL fw_putc                    ; one dot per block
        INC R6
        DEC R7
        JNE .block

        ; ---- 5. verify the checksum ----
        LD R0, [fw_ksum]
        CMP R0, R5
        JNE fw_bad_sum
        MOVP P2, #msg_sumok
        CALL fw_puts

        ; ---- 6. hand over to the kernel ----
        MOVP P2, #msg_jump
        CALL fw_puts
        LDW P0, [fw_kentry]
        CALL fw_puthex16
        MOVP P2, #msg_newline
        CALL fw_puts
        LDW P0, [fw_kentry]
        JMP P0                          ; supervisor mode, interrupts disabled

; =====================================================================
; Storage driver: read block P0 into the controller buffer.
; Returns R0 = 0 on success or the controller error code.
; =====================================================================
fw_disk_read:
        ST [DISK_BLOCK_LO], R1
        ST [DISK_BLOCK_HI], R0
        MOV R0, #DISK_CMD_READ
        ST [DISK_CMD], R0
.poll:  LD R0, [DISK_STATUS]            ; poll until DONE or ERROR
        AND R0, #DISK_DONE | DISK_ERROR
        JEQ .poll
        AND R0, #DISK_ERROR
        JNE .err
        RET                             ; R0 = 0
.err:   LD R0, [DISK_ERRCODE]
        RET

; =====================================================================
; Terminal output
; =====================================================================
; fw_putc: print R0. Preserves all registers.
fw_putc:
        PUSH R1
.wait:  LD R1, [TERM_STATUS]
        AND R1, #TERM_READY
        JEQ .wait
        ST [TERM_DATA], R0
        POP R1
        RET

; fw_puts: print the NUL-terminated string at P2. Advances P2.
fw_puts:
        PUSH R0
.loop:  LD R0, [P2]
        CMP R0, #0
        JEQ .done
        CALL fw_putc
        INCP P2
        JMP .loop
.done:  POP R0
        RET

; fw_puthex8: print R0 as two hex digits. Preserves all registers.
fw_puthex8:
        PUSH R0
        PUSH R1
        MOV R1, R0
        SHR R0
        SHR R0
        SHR R0
        SHR R0
        CALL fw_hexdigit
        MOV R0, R1
        AND R0, #0x0F
        CALL fw_hexdigit
        POP R1
        POP R0
        RET

; fw_puthex16: print P0 as four hex digits. Preserves all registers.
fw_puthex16:
        PUSH R0
        CALL fw_puthex8                 ; high byte (R0)
        MOV R0, R1
        CALL fw_puthex8                 ; low byte (R1)
        POP R0
        RET

; fw_hexdigit: print the hex digit for R0 (0-15). Clobbers R0.
fw_hexdigit:
        CMP R0, #10
        JCS .num
        ADD R0, #'A' - 10
        JMP fw_putc
.num:   ADD R0, #'0'
        JMP fw_putc

; =====================================================================
; Failure paths
; =====================================================================
fw_bad_machine:
        MOVP P2, #msg_badmach
        JMP fw_fail
fw_no_os:
        MOVP P2, #msg_noos
        JMP fw_fail
fw_bad_sum:
        MOVP P2, #msg_badsum
        JMP fw_fail
fw_bad_layout:
        MOVP P2, #msg_badlayout
        JMP fw_fail
fw_disk_error:
        PUSH R0
        MOVP P2, #msg_diskerr
        CALL fw_puts
        POP R0
        CALL fw_puthex8
        MOVP P2, #msg_newline
fw_fail:
        CALL fw_puts
        MOVP P2, #msg_halted
        CALL fw_puts
        MOV R0, #0
        ST [PIC_MASK], R0               ; no interrupt can wake us
fw_hang:
        HLT
        JMP fw_hang

fw_unexpected:
        MOVP P2, #msg_unexp
        CALL fw_puts
        MFC P0, CAUSE
        MOV R0, R1
        CALL fw_puthex8
        MOVP P2, #msg_newline
        JMP fw_fail

; =====================================================================
; Messages
; =====================================================================
msg_banner:  .asciz "VC-8 Workshop Boot ROM v1.0\n"
msg_probe:   .asciz "Probing storage: "
msg_256:     .asciz "256 blocks of 256 bytes\n"
msg_blocks:  .asciz " blocks\n"
msg_bootblk: .asciz "Reading boot block 0... "
msg_kimage:  .asciz "OK\nKernel image: 0x"
msg_kblocks: .asciz " blocks, load address 0x"
msg_loading: .asciz "Loading kernel "
msg_sumok:   .asciz " checksum OK\n"
msg_jump:    .asciz "Jumping to kernel entry at 0x"
msg_newline: .asciz "\n"
msg_badmach: .asciz "\nUnknown machine ID\n"
msg_noos:    .asciz "\nNo bootable kernel: bad boot block\n"
msg_badsum:  .asciz "\nKernel checksum mismatch\n"
msg_badlayout: .asciz "\nBoot block describes an invalid kernel layout\n"
msg_diskerr: .asciz "\nStorage error, code 0x"
msg_unexp:   .asciz "\nFIRMWARE: unexpected exception, CAUSE=0x"
msg_halted:  .asciz "System halted.\n"
