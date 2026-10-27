; =====================================================================
; syscall.asm — system-call dispatcher and services
;
; ABI (see syscalls.inc): R0 = number, R1 = byte argument, P1 = pointer
; argument. Results go back in the caller's R0 (value) and R1 (error).
; Arguments are read from, and results written to, the trap frame.
; Handlers are entered with P2 = trap frame and P3 = caller's PCB, and
; may use any register.
; =====================================================================

NSYSCALLS       = 10
E_OK            = 0
E_NOSYS         = 1
E_FAULT         = 2
E_IO            = 3
E_INVAL         = 4

syscall_dispatch:
        LDW P0, [P3+PCB_SYSCALLS]
        INCP P0
        STW [P3+PCB_SYSCALLS], P0
        LDW P2, [kframe]
        LD R0, [P2+FR_R0]               ; system-call number
        CMP R0, #NSYSCALLS
        JCC sys_invalid                 ; unsigned >= NSYSCALLS
        SHL R0
        MOVP P1, #syscall_table
        ADDP P1, R0
        LDW P1, [P1]                    ; handler address
        JMP P1

syscall_table:
        .word sys_exit                  ; 0
        .word sys_putc                  ; 1
        .word sys_puts                  ; 2
        .word sys_getc                  ; 3
        .word sys_kbhit                 ; 4
        .word sys_yield                 ; 5
        .word sys_getpid                ; 6
        .word sys_setled                ; 7
        .word sys_readblk               ; 8
        .word sys_sleep                 ; 9

; sys_return: R0 = result, R1 = error code. Writes them into the
; caller's saved registers and resumes it.
sys_return:
        LDW P2, [kframe]
        ST [P2+FR_R0], R0
        ST [P2+FR_R1], R1
        JMP resume_current

sys_invalid:
        MOV R0, #0xFF
        MOV R1, #E_NOSYS
        JMP sys_return

; ---- 0: exit(R1 = code) --------------------------------------------
sys_exit:
        LD R1, [P2+FR_R1]
        ST [P3+PCB_EXIT], R1
        MOV R0, #ST_EXITED
        ST [P3+PCB_STATE], R0
        MOVP P2, #msg_kernel
        CALL kputs
        CALL kputproc
        MOVP P2, #msg_exited
        CALL kputs
        LD R0, [P3+PCB_EXIT]
        CALL kputdec8
        CALL kputnl
        JMP schedule

; ---- 1: putc(R1 = character) ----------------------------------------
sys_putc:
        LD R0, [P2+FR_R1]
        CALL kputc
        MOV R0, #1
        MOV R1, #E_OK
        JMP sys_return

; ---- 2: puts(P1 = string) -> R0 = characters written -----------------
; Every byte is checked against the caller's window before it is read:
; the kernel can read any memory, so it must not trust user pointers.
sys_puts:
        LDW P1, [P2+FR_P1]              ; user pointer
        MOV R5, #0                      ; characters written
.loop:  LDW P0, [P3+PCB_BASE]
        CMPP P1, P0
        JCS .fault                      ; below the caller's window
        LDW P0, [P3+PCB_LIMIT]
        CMPP P1, P0
        JCC .fault                      ; at or above the limit
        LD R4, [P1]
        CMP R4, #0
        JEQ .done
        MOV R0, R4
        CALL kputc
        INCP P1
        INC R5
        JNE .loop                       ; at most 255 characters
.done:  MOV R0, R5
        MOV R1, #E_OK
        JMP sys_return
.fault: MOV R0, R5
        MOV R1, #E_FAULT
        JMP sys_return

; ---- 3: getc() -> R0 = key; blocks while no key is available ---------
sys_getc:
        CALL kbd_get                    ; R0 = key, R1 = 0; or R1 = 1 if empty
        CMP R1, #0
        JNE .block
        MOV R1, #E_OK
        JMP sys_return
.block: MOV R0, #ST_BLOCKED
        ST [P3+PCB_STATE], R0
        MOV R0, #W_KEYBOARD
        ST [P3+PCB_WAIT], R0
        LDW P2, [kframe]                ; re-execute SYS when woken:
        LDW P0, [P2+FR_PC]              ; saved PC points after the 1-byte SYS,
        DECP P0                         ; so step it back by one
        STW [P2+FR_PC], P0
        JMP schedule

; ---- 4: kbhit() -> R0 = 1 if a key is waiting --------------------------
sys_kbhit:
        LD R0, [kbd_count]
        CMP R0, #0
        JEQ .none
        MOV R0, #1
.none:  MOV R1, #E_OK
        JMP sys_return

; ---- 5: yield() ---------------------------------------------------------
sys_yield:
        MOV R0, #0
        ST [P2+FR_R0], R0
        ST [P2+FR_R1], R0
        MOV R0, #ST_READY
        ST [P3+PCB_STATE], R0
        JMP schedule

; ---- 6: getpid() -> R0 ----------------------------------------------------
sys_getpid:
        LD R0, [P3+PCB_PID]
        MOV R1, #E_OK
        JMP sys_return

; ---- 7: setled(R1 = pattern) -----------------------------------------------
sys_setled:
        LD R0, [P2+FR_R1]
        CALL led_set
        MOV R1, #E_OK
        JMP sys_return

; ---- 8: readblk(R1 = block, P1 = 256-byte buffer) ----------------------------
sys_readblk:
        LD R4, [P2+FR_R1]               ; R4 = block number
        LDW P1, [P2+FR_P1]              ; P1 = user buffer
        LDW P0, [P3+PCB_BASE]
        CMPP P1, P0
        JCS .fault                      ; buffer starts below the window
        MOVP P0, P1
        INC R0                          ; P0 = buffer + 256 (high byte + 1)
        JEQ .fault                      ; wrapped past 0xFFFF
        LDW P2, [P3+PCB_LIMIT]
        CMPP P0, P2
        JGTU .fault                     ; buffer ends beyond the window
        MOV R0, #0
        MOV R1, R4                      ; P0 = block
        CALL disk_read                  ; copies into the user's buffer
        CMP R0, #0
        JNE .io
        MOV R1, #E_OK
        JMP sys_return
.io:    MOV R0, #0
        MOV R1, #E_IO
        JMP sys_return
.fault: MOV R0, #0
        MOV R1, #E_FAULT
        JMP sys_return

; ---- 9: sleep(R1 = ticks) ------------------------------------------------------
sys_sleep:
        LD R0, [P2+FR_R1]
        CMP R0, #0
        JEQ sys_yield
        ST [P3+PCB_SLEEP], R0
        MOV R0, #0
        ST [P2+FR_R0], R0               ; results when it wakes: R0 = 0, R1 = E_OK
        ST [P2+FR_R1], R0
        MOV R0, #ST_BLOCKED
        ST [P3+PCB_STATE], R0
        MOV R0, #W_SLEEP
        ST [P3+PCB_WAIT], R0
        JMP schedule
