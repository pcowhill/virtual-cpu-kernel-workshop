; =====================================================================
; sched.asm — process table, process creation, round-robin scheduler
; =====================================================================

; pcb_addr: P3 = address of PCB number R0 (0..MAX_PROCS-1). Preserves R0.
pcb_addr:
        PUSH R0
        SHL R0                          ; R0 * 32 = R0 << 5
        SHL R0
        SHL R0
        SHL R0
        SHL R0
        MOVP P3, #proc_table
        ADDP P3, R0
        POP R0
        RET

; ---------------------------------------------------------------------
; schedule: pick the next READY process after `current` (round robin)
; and resume it. If none is ready, idle until an interrupt makes one
; ready. Never returns.
; ---------------------------------------------------------------------
schedule:
        LD R0, [current]
        MOV R4, #MAX_PROCS              ; candidates left to examine
.next:  INC R0
        CMP R0, #MAX_PROCS
        JCS .valid                      ; R0 < MAX_PROCS
        MOV R0, #0
.valid: CALL pcb_addr
        LD R1, [P3+PCB_STATE]
        CMP R1, #ST_READY
        JEQ .found
        DEC R4
        JNE .next
        JMP idle

.found: ST [current], R0
        ; The timer is a fixed periodic tick (it is never reloaded here, so
        ; timekeeping and sleepers stay accurate even when processes yield
        ; often). If it expired while the kernel itself was running, service
        ; that tick now; otherwise the interrupt would be taken immediately
        ; after RTI and, if kernel work ever exceeded a quantum, no process
        ; could make progress (interrupt livelock).
        LD R1, [PIC_PENDING]
        AND R1, #IRQ_TIMER
        JEQ .nopend
        PUSH R0
        CALL timer_service              ; acknowledges, counts the tick, wakes sleepers
        POP R0
.nopend:
        LD R1, [TIMER_CTRL]             ; tickless idle may have stopped the timer:
        AND R1, #TIMER_EN
        JNE .ticking
        MOV R1, #TIMER_EN | TIMER_IE | TIMER_PERIODIC
        ST [TIMER_CTRL], R1             ; restart it (EN 0 -> 1 reloads COUNT)
.ticking:
        MOV R1, #ST_RUNNING
        ST [P3+PCB_STATE], R1
        LDW P0, [P3+PCB_RUNS]
        INCP P0
        STW [P3+PCB_RUNS], P0
        LDW P0, [switches]
        INCP P0
        STW [switches], P0
        JMP resume_current

; ---------------------------------------------------------------------
; idle: nothing is ready. Wait for an interrupt line, service it by
; polling (interrupts stay disabled in the kernel), then reschedule.
; ---------------------------------------------------------------------
idle:
        CALL count_alive
        CMP R0, #0
        JEQ all_done
        MOV R0, #0xFF
        ST [current], R0                ; no process is running
        MOVP SP, #KSTACK_IDLE           ; every process's frame is safe in its PCB
        CALL any_sleeping
        CMP R0, #0
        JNE .wait                       ; sleepers need timer ticks
        ST [TIMER_CTRL], R0             ; tickless idle: stop the timer (dispatch restarts it)
.wait:  HLT                             ; sleep until an enabled IRQ line is pending
        LDW P0, [idle_wakeups]
        INCP P0
        STW [idle_wakeups], P0
        LD R0, [PIC_PENDING]
        PUSH R0
        AND R0, #IRQ_TIMER
        JEQ .notimer
        CALL timer_service
.notimer:
        POP R0
        AND R0, #IRQ_KEYBOARD
        JEQ .nokbd
        CALL kbd_service
.nokbd: JMP schedule

; any_sleeping: R0 = 1 if some process is blocked in sleep, else 0.
; Changes R0, R1, R2, P3.
any_sleeping:
        MOV R2, #MAX_PROCS
        MOVP P3, #proc_table
.loop:  LD R1, [P3+PCB_STATE]
        CMP R1, #ST_BLOCKED
        JNE .next
        LD R1, [P3+PCB_WAIT]
        CMP R1, #W_SLEEP
        JEQ .yes
.next:  ADDP P3, #PCB_SIZE
        DEC R2
        JNE .loop
        MOV R0, #0
        RET
.yes:   MOV R0, #1
        RET

; count_alive: R0 = number of processes that are READY, RUNNING or BLOCKED.
; Changes R0, R1, R2, P3.
count_alive:
        MOV R2, #0
        MOV R0, #MAX_PROCS
        MOVP P3, #proc_table
.loop:  LD R1, [P3+PCB_STATE]
        CMP R1, #ST_READY
        JCS .skip                       ; FREE
        CMP R1, #ST_EXITED
        JCC .skip                       ; EXITED
        INC R2
.skip:  ADDP P3, #PCB_SIZE
        DEC R0
        JNE .loop
        MOV R0, R2
        RET

all_done:
        MOVP P2, #msg_alldone
        CALL kputs
halt_system:
        MOV R0, #0
        ST [TIMER_CTRL], R0
        ST [PIC_MASK], R0               ; nothing can wake the CPU
        MOV R0, #0xFF
        ST [current], R0
.halt:  HLT
        JMP .halt

; ---------------------------------------------------------------------
; proc_create: create process number R0 from boot-block program entry R0.
; Loads its image from storage into its memory slot and builds an
; initial trap frame so that resume_current "returns" to its entry point
; in user mode.
; ---------------------------------------------------------------------
proc_create:
        CALL pcb_addr                   ; P3 = PCB
        MOV R1, R0
        INC R1
        ST [P3+PCB_PID], R1             ; pid = index + 1
        ST [P3+PCB_SLOT], R0
        ; memory window: base = 0x6000 + index * 0x2000, limit = base + 0x2000
        MOV R2, R0
        SHL R2
        SHL R2
        SHL R2
        SHL R2
        SHL R2                          ; index * 0x20
        ADD R2, #URAM_START >> 8
        MOV R3, #0
        STW [P3+PCB_BASE], P1
        ADD R2, #SLOT_SIZE_HI
        STW [P3+PCB_LIMIT], P1

        ; P2 = boot-block program entry
        PUSH R0
        SHL R0
        SHL R0
        SHL R0
        SHL R0                          ; index * 16
        MOVP P2, #disk_buf + HDR_PROGS
        ADDP P2, R0
        POP R0

        ; copy the 8-byte name
        LD R0, [P2+PE_NAME+0]
        ST [P3+PCB_NAME+0], R0
        LD R0, [P2+PE_NAME+1]
        ST [P3+PCB_NAME+1], R0
        LD R0, [P2+PE_NAME+2]
        ST [P3+PCB_NAME+2], R0
        LD R0, [P2+PE_NAME+3]
        ST [P3+PCB_NAME+3], R0
        LD R0, [P2+PE_NAME+4]
        ST [P3+PCB_NAME+4], R0
        LD R0, [P2+PE_NAME+5]
        ST [P3+PCB_NAME+5], R0
        LD R0, [P2+PE_NAME+6]
        ST [P3+PCB_NAME+6], R0
        LD R0, [P2+PE_NAME+7]
        ST [P3+PCB_NAME+7], R0
        LDW P0, [P2+PE_ENTRY]
        STW [P3+PCB_ENTRY], P0

        ; validate: base <= load and load + count*256 <= limit
        LDW P1, [P2+PE_LOAD]            ; P1 = load address
        LDW P0, [P3+PCB_BASE]
        CMPP P1, P0
        JCS .bad                        ; load < base
        LD R0, [P2+PE_COUNT]
        ADD R2, R0                      ; P1 = load + count * 256
        JCS .bad
        LDW P0, [P3+PCB_LIMIT]
        CMPP P1, P0
        JGTU .bad                       ; image would overrun the slot
        ; the entry point must lie inside the window too
        LDW P0, [P3+PCB_ENTRY]
        LDW P1, [P3+PCB_BASE]
        CMPP P0, P1
        JCS .bad
        LDW P1, [P3+PCB_LIMIT]
        CMPP P0, P1
        JCC .bad

        ; load the image block by block with the storage driver
        LDW P1, [P2+PE_LOAD]            ; P1 = destination (advanced by disk_read)
        LD R0, [P2+PE_COUNT]
        LD R4, [P2+PE_BLOCK]            ; R4 = next block (this overwrites P2's high byte;
        MOV R5, R0                      ;  P2 is not needed any more). R5 = blocks left
        CMP R5, #0
        JEQ .loaded
.load:  MOV R0, #0
        MOV R1, R4                      ; P0 = block number
        CALL disk_read
        CMP R0, #0
        JNE .ioerr
        INC R4
        DEC R5
        JNE .load
.loaded:

        ; build the initial trap frame at the top of this process's kernel stack
        LD R0, [P3+PCB_SLOT]
        INC R0
        ADD R0, #KSTACKS >> 8           ; top = KSTACKS + (slot + 1) * 0x100
        MOV R1, #0
        ADDP P0, #-FRAME_SIZE           ; P0 = frame address
        STW [P3+PCB_KSP], P0
        MOVP P1, P0                     ; P1 = frame pointer
        LDW P0, [P3+PCB_LIMIT]
        STW [P1+FR_USP], P0             ; user stack starts at the top of the slot
        MOV R0, #0
        ST [P1+FR_R7], R0               ; all registers start at zero
        ST [P1+FR_R6], R0
        ST [P1+FR_R5], R0
        ST [P1+FR_R4], R0
        ST [P1+FR_R3], R0
        ST [P1+FR_R2], R0
        ST [P1+FR_R1], R0
        ST [P1+FR_R0], R0
        MOV R0, #INITIAL_PSW            ; user mode, interrupts enabled
        ST [P1+FR_PSW], R0
        LDW P0, [P3+PCB_ENTRY]
        STW [P1+FR_PC], P0
        MOV R0, #ST_READY
        ST [P3+PCB_STATE], R0

        MOVP P2, #msg_kernel
        CALL kputs
        CALL kputproc
        MOVP P2, #msg_loaded
        CALL kputs
        LDW P0, [P3+PCB_BASE]
        CALL kputhex16
        MOVP P2, #msg_dash
        CALL kputs
        LDW P0, [P3+PCB_LIMIT]
        DECP P0
        CALL kputhex16
        MOVP P2, #msg_entry
        CALL kputs
        LDW P0, [P3+PCB_ENTRY]
        CALL kputhex16
        CALL kputnl
        RET

.bad:   MOVP P2, #msg_kernel
        CALL kputs
        CALL kputproc
        MOVP P2, #msg_badimage
        CALL kputs
        MOV R0, #ST_FREE
        ST [P3+PCB_STATE], R0
        RET
.ioerr: MOVP P2, #msg_kernel
        CALL kputs
        CALL kputproc
        MOVP P2, #msg_ioerr
        CALL kputs
        MOV R0, #ST_FREE
        ST [P3+PCB_STATE], R0
        RET

; kputproc: print "pid N 'name'" for the PCB at P3. Preserves all registers.
kputproc:
        PUSH R0
        PUSHP P2
        MOVP P2, #msg_pid
        CALL kputs
        LD R0, [P3+PCB_PID]
        CALL kputdec8
        MOV R0, #' '
        CALL kputc
        MOV R0, #0x27                   ; quote
        CALL kputc
        MOVP P2, P3
        ADDP P2, #PCB_NAME
        PUSH R1
        MOV R1, #8                      ; at most 8 characters
.ch:    LD R0, [P2]
        CMP R0, #0
        JEQ .end
        CALL kputc
        INCP P2
        DEC R1
        JNE .ch
.end:   POP R1
        MOV R0, #0x27
        CALL kputc
        POPP P2
        POP R0
        RET
