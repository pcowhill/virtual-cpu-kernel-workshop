; echo — interactive: reads keys with the blocking getc system call and
; echoes them in upper case. While waiting it is BLOCKED, so it uses no
; CPU time; the keyboard interrupt wakes it. Type ~ to exit.
        .include "syscalls.inc"

        .org PROC_BASE
start:  MOVP P1, #prompt
        MOV R0, #SYS_PUTS
        SYS
.key:   MOV R0, #SYS_GETC
        SYS                     ; R0 = key (blocks until one arrives)
        CMP R0, #'~'
        JEQ .quit
        CMP R0, #'a'
        JCS .out                ; below 'a'
        CMP R0, #'z' + 1
        JCC .out                ; above 'z'
        SUB R0, #0x20           ; to upper case
.out:   MOV R1, R0
        MOV R0, #SYS_PUTC
        SYS
        CMP R1, #13             ; Enter: start a new line
        JNE .key
        MOV R1, #10
        MOV R0, #SYS_PUTC
        SYS
        JMP .key
.quit:  MOVP P1, #bye
        MOV R0, #SYS_PUTS
        SYS
        MOV R0, #SYS_EXIT
        MOV R1, #0
        SYS

prompt: .asciz "\n[echo] type something (~ to quit): "
bye:    .asciz "\n[echo] bye\n"
