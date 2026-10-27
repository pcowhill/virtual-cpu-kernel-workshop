; led-blink — drives the LEDs with a delay loop. The delay length comes
; from the switches (flip them in the Devices lab), so the same program
; blinks faster or slower. 16 steps, then all LEDs off.
        .include "vc8.inc"
        .org 0x0000
        .word start
        .org 0x0100
start:  MOV R4, #16             ; steps
        MOV R5, #0x01           ; pattern
step:   ST [GPIO_LEDS], R5
        LD R6, [GPIO_SWITCHES]  ; delay length from the switches
        OR R6, #0x08            ; at least 8 outer iterations
.outer: MOV R7, #0
.inner: DEC R7                  ; 256 iterations
        JNE .inner
        DEC R6
        JNE .outer
        SHL R5                  ; next LED
        JNE .same
        MOV R5, #0x01
.same:  DEC R4
        JNE step
        MOV R0, #0
        ST [GPIO_LEDS], R0
        HLT
