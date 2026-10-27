; intruder — tries to write just past its own memory window, into the
; next process's slot. The CPU's protection unit stops the store and the
; kernel terminates this process; everyone else keeps running.
        .include "syscalls.inc"
TARGET  = PROC_BASE + 0x2000

        .org PROC_BASE
start:  MOVP P1, #msg
        MOV R0, #SYS_PUTS
        SYS
        MOV R0, #0x66
        ST [TARGET], R0         ; write violation -> vector 3
        MOVP P1, #survived      ; never reached
        MOV R0, #SYS_PUTS
        SYS
        MOV R0, #SYS_EXIT
        MOV R1, #0
        SYS
msg:      .asciz "[intruder] writing into another process's memory...\n"
survived: .asciz "[intruder] the write succeeded?!\n"
