; timer-interrupt — a bare-metal interrupt handler. The timer fires every
; 500 cycles; the CPU saves PC and PSW, enters vector 8 and runs `tick`,
; which acknowledges the timer, counts and prints a dot. The main program
; just sleeps in HLT between interrupts. After 10 ticks it stops.
        .include "vc8.inc"
ticks   = 0x2000
        .org 0x0000
        .word start                     ; vector 0: reset
        .word 0xFFFF, 0xFFFF, 0xFFFF    ; 1-3: faults (no handler)
        .word 0xFFFF, 0xFFFF            ; 4-5
        .word 0xFFFF, 0xFFFF            ; 6-7
        .word tick                      ; 8: IRQ0 timer
        .org 0x0100
start:  MOVP SP, #0x3000
        MOVP P0, #500
        ST [TIMER_RELOAD_LO], R1
        ST [TIMER_RELOAD_HI], R0
        MOV R0, #TIMER_EN | TIMER_IE | TIMER_PERIODIC
        ST [TIMER_CTRL], R0
        MOV R0, #IRQ_TIMER
        ST [PIC_MASK], R0       ; let line 0 through the interrupt controller
        STI                     ; ... and let the CPU take interrupts
wait:   HLT                     ; sleep; the interrupt wakes us
        LD R0, [ticks]
        CMP R0, #10
        JNE wait
        CLI
        MOV R0, #0
        ST [TIMER_CTRL], R0
        ST [PIC_MASK], R0
        MOVP P1, #done
        CALL con_puts
        HLT

; Interrupt handler: the CPU already pushed PC and PSW and cleared I.
tick:   PUSH R0                 ; save what we use
        MOV R0, #TIMER_EXPIRED
        ST [TIMER_STATUS], R0   ; acknowledge (drops IRQ line 0)
        LD R0, [ticks]
        INC R0
        ST [ticks], R0
        MOV R0, #'.'
        CALL con_putc
        POP R0
        RTI                     ; restore PSW (I = 1) and PC
done:   .asciz "\n10 timer interrupts handled.\n"
        .include "lib/console.asm"
