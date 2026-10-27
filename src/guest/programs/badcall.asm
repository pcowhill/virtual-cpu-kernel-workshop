; badcall — shows how the kernel reports system-call errors:
; an unknown call number (E_NOSYS) and a pointer into kernel memory
; (E_FAULT). The kernel validates every user pointer.
        .include "syscalls.inc"

        .org PROC_BASE
start:  MOV R0, #42             ; no such system call
        SYS
        ST [err1], R1           ; expect E_NOSYS
        MOVP P1, #0x2000        ; a kernel address
        MOV R0, #SYS_PUTS
        SYS
        ST [err2], R1           ; expect E_FAULT
        LD R0, [err1]
        CMP R0, #E_NOSYS
        JNE .bad
        LD R0, [err2]
        CMP R0, #E_FAULT
        JNE .bad
        MOVP P1, #ok
        MOV R0, #SYS_PUTS
        SYS
        MOV R0, #SYS_EXIT
        MOV R1, #0
        SYS
.bad:   MOV R0, #SYS_EXIT
        MOV R1, #1
        SYS
ok:     .asciz "[badcall] kernel rejected both bad calls\n"
err1:   .byte 0
err2:   .byte 0
