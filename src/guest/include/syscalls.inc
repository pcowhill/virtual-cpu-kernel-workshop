; =====================================================================
; syscalls.inc — Workshop Kernel system-call ABI for user programs
;
;   R0      = system-call number
;   R1      = first byte argument
;   P1      = pointer argument (R2 = high byte, R3 = low byte)
;   SYS     = trap into the kernel (vector 4)
; On return:
;   R0      = result value
;   R1      = error code (E_OK = 0 on success)
;   R2..R7 and SP are preserved. Flags are not preserved.
; =====================================================================

SYS_EXIT        = 0             ; R1 = exit code. Does not return.
SYS_PUTC        = 1             ; R1 = character
SYS_PUTS        = 2             ; P1 = NUL-terminated string in your memory. R0 = characters written
SYS_GETC        = 3             ; R0 = next key. Blocks until a key is available
SYS_KBHIT       = 4             ; R0 = 1 if a key is waiting, else 0
SYS_YIELD       = 5             ; give up the rest of the time slice
SYS_GETPID      = 6             ; R0 = process id
SYS_SETLED      = 7             ; R1 = LED pattern
SYS_READBLK     = 8             ; R1 = block number, P1 = 256-byte buffer in your memory
SYS_SLEEP       = 9             ; R1 = timer ticks to sleep (0 = yield)

E_OK            = 0
E_NOSYS         = 1             ; unknown system call
E_FAULT         = 2             ; pointer outside the caller's memory
E_IO            = 3             ; storage error
E_INVAL         = 4             ; invalid argument
