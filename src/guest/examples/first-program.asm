; first-program — your first VC-8 program (bare metal: no operating system).
; Adds 1 + 2 + ... + 10, stores the result in RAM, shows it on the LEDs and
; prints a message on the terminal.
;
; Try: assemble it, look at the bytes in the listing, step it with F10 and
; watch R0, R1 and the Z flag change.
        .include "vc8.inc"

result  = 0x2000                ; a variable in RAM

        .org 0x0000
        .word start             ; reset vector: the CPU loads PC from here

        .org 0x0100
start:  MOV R0, #0              ; R0 = running total
        MOV R1, #10             ; R1 = counter
loop:   ADD R0, R1              ; total = total + counter
        DEC R1                  ; counter = counter - 1 (sets Z when it reaches 0)
        JNE loop                ; repeat while counter != 0
        ST [result], R0         ; store the total (55 = 0x37) in RAM
        ST [GPIO_LEDS], R0      ; ... and show it on the LEDs
        MOVP P1, #message       ; P1 = R2:R3 points at the text
print:  LD R4, [P1]
        CMP R4, #0
        JEQ done
        ST [TERM_DATA], R4      ; memory-mapped terminal output
        INCP P1
        JMP print
done:   HLT                     ; stop: no interrupt can wake us

message: .asciz "1 + 2 + ... + 10 = 0x37. Look at R0, the LEDs and RAM 0x2000.\n"
