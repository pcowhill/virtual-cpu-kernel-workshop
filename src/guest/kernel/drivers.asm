; =====================================================================
; drivers.asm — device drivers (all access memory-mapped registers)
; =====================================================================

; ---- terminal -------------------------------------------------------
; kputc: write R0 to the terminal. Preserves all registers.
kputc:
        PUSH R1
.wait:  LD R1, [TERM_STATUS]
        AND R1, #TERM_READY
        JEQ .wait
        ST [TERM_DATA], R0
        POP R1
        RET

; ---- LEDs -----------------------------------------------------------
; led_set: show pattern R0 on the LEDs. Preserves all registers.
led_set:
        ST [GPIO_LEDS], R0
        RET

; ---- timer ----------------------------------------------------------
; timer_service: acknowledge the timer, count the tick and wake any
; process whose sleep has finished. Changes R0, R1, P0. Preserves P3.
timer_service:
        MOV R0, #TIMER_EXPIRED
        ST [TIMER_STATUS], R0           ; acknowledge: deasserts IRQ line 0
        ; fall through
; timer_tick: count one tick and wake sleepers. Changes R0, R1, P0. Preserves P3.
timer_tick:
        LDW P0, [ticks]
        INCP P0
        STW [ticks], P0
        PUSHP P3
        MOV R0, #MAX_PROCS
        MOVP P3, #proc_table
.loop:  LD R1, [P3+PCB_STATE]
        CMP R1, #ST_BLOCKED
        JNE .next
        LD R1, [P3+PCB_WAIT]
        CMP R1, #W_SLEEP
        JNE .next
        LD R1, [P3+PCB_SLEEP]
        DEC R1
        ST [P3+PCB_SLEEP], R1
        JNE .next
        MOV R1, #ST_READY               ; sleep over
        ST [P3+PCB_STATE], R1
        MOV R1, #W_NONE
        ST [P3+PCB_WAIT], R1
.next:  ADDP P3, #PCB_SIZE
        DEC R0
        JNE .loop
        POPP P3
        RET

; timer_restart: give the next process a full quantum without losing time.
; Stops the timer (COUNT freezes), counts an expiry that happened while the
; kernel was running, adds the part of the current period that has already
; elapsed to tick_acc (counting a tick whenever that reaches QUANTUM), then
; restarts the timer: EN 0 -> 1 reloads COUNT with QUANTUM.
; Changes R0-R3, P0. Preserves P3.
timer_restart:
        MOV R0, #TIMER_IE | TIMER_PERIODIC
        ST [TIMER_CTRL], R0             ; stop
        LD R0, [TIMER_STATUS]
        AND R0, #TIMER_EXPIRED
        JEQ .partial
        CALL timer_service              ; a whole period ended during kernel work
.partial:
        MOVP P1, #QUANTUM
        LD R1, [TIMER_COUNT_LO]
        LD R0, [TIMER_COUNT_HI]         ; P0 = COUNT (frozen)
        SUBP P1, P0                     ; P1 = cycles of this period already used
        LDW P0, [tick_acc]
        ADDP P0, P1
        CMPP P0, #QUANTUM
        JCS .keep                       ; less than a whole tick so far
        ADDP P0, #-QUANTUM
        STW [tick_acc], P0
        CALL timer_tick                 ; the partial periods add up to a tick
        JMP .start
.keep:  STW [tick_acc], P0
.start: MOV R0, #TIMER_EN | TIMER_IE | TIMER_PERIODIC
        ST [TIMER_CTRL], R0             ; restart: COUNT = QUANTUM
        RET

; ---- keyboard -------------------------------------------------------
; kbd_service: move every byte from the keyboard FIFO into the kernel's
; ring buffer (reading DATA dequeues and eventually deasserts IRQ line 1),
; then wake processes blocked in getc. Changes R0, R1, P1. Preserves P3.
kbd_service:
        PUSHP P3
.drain: LD R0, [KBD_STATUS]
        AND R0, #KBD_AVAIL
        JEQ .wake
        LD R0, [KBD_DATA]
        CALL kbd_put
        JMP .drain
.wake:  LD R0, [kbd_count]
        CMP R0, #0
        JEQ .done
        MOV R0, #MAX_PROCS
        MOVP P3, #proc_table
.loop:  LD R1, [P3+PCB_STATE]
        CMP R1, #ST_BLOCKED
        JNE .next
        LD R1, [P3+PCB_WAIT]
        CMP R1, #W_KEYBOARD
        JNE .next
        MOV R1, #ST_READY
        ST [P3+PCB_STATE], R1
        MOV R1, #W_NONE
        ST [P3+PCB_WAIT], R1
.next:  ADDP P3, #PCB_SIZE
        DEC R0
        JNE .loop
.done:  POPP P3
        RET

; kbd_put: append R0 to the ring buffer (dropped if full). Changes R1, P1.
kbd_put:
        LD R1, [kbd_count]
        CMP R1, #KBD_BUF_SIZE
        JEQ .full
        INC R1
        ST [kbd_count], R1
        LD R1, [kbd_tail]
        MOVP P1, #kbd_buf
        ADDP P1, R1
        ST [P1], R0
        INC R1
        AND R1, #KBD_BUF_SIZE - 1
        ST [kbd_tail], R1
.full:  RET

; kbd_get: R0 = next byte and R1 = 0, or R1 = 1 if the buffer is empty.
; Changes R0, R1, P1.
kbd_get:
        LD R1, [kbd_count]
        CMP R1, #0
        JEQ .empty
        DEC R1
        ST [kbd_count], R1
        LD R1, [kbd_head]
        MOVP P1, #kbd_buf
        ADDP P1, R1
        LD R0, [P1]
        INC R1
        AND R1, #KBD_BUF_SIZE - 1
        ST [kbd_head], R1
        MOV R1, #0
        RET
.empty: MOV R1, #1
        RET

; ---- block storage --------------------------------------------------
; disk_read: read block P0 and copy its 256 bytes to memory at P1
; (programmed I/O through the DATA port). Advances P1 by 256.
; Returns R0 = 0 on success or the controller's error code.
; Changes R0, R1.
disk_read:
        ST [DISK_BLOCK_LO], R1
        ST [DISK_BLOCK_HI], R0
        MOV R0, #DISK_CMD_READ
        ST [DISK_CMD], R0
.poll:  LD R0, [DISK_STATUS]            ; the controller is busy for a fixed time
        AND R0, #DISK_DONE | DISK_ERROR
        JEQ .poll
        AND R0, #DISK_ERROR
        JNE .err
        MOV R1, #0                      ; 256 bytes
.copy:  LD R0, [DISK_DATA]
        ST [P1], R0
        INCP P1
        DEC R1
        JNE .copy
        MOV R0, #0
        RET
.err:   LD R0, [DISK_ERRCODE]
        RET
