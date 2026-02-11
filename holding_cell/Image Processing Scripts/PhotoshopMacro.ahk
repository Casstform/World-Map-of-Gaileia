; ============================================================
; Photoshop Macro (AHK v2) — toggle, repeat, tooltip w/ elapsed time, failsafe
; Hotkey: Ctrl+Alt+Y (Photoshop only)
; Stop:   Ctrl+Alt+Y (toggle off)  |  Esc (kills script)
; ============================================================

SendMode "Input"
SetKeyDelay 30, 30
Esc::ExitApp

; ---- Tunables ----
MAX_RUNTIME_MS := 5 * 60 * 1000   ; 5-minute failsafe (total runtime)
STEP_SLEEP_MS  := 300              ; delay between major steps
CYCLE_PAUSE_MS := 300             ; delay between full macro cycles

; ---- State ----
global gRunning := false
global gStartTick := 0

; ---- Photoshop only ----
#HotIf WinActive("ahk_exe Photoshop.exe")

^!y:: {
    global gRunning, gStartTick

    ; Toggle OFF
    if gRunning {
        StopMacro("Macro stopped.")
        return
    }

    ; Toggle ON
    gRunning := true
    gStartTick := A_TickCount
    ToolTip "Macro started..."
    SetTimer ClearToolTip, -600
    SetTimer FailsafeStop, 100

    RunMacroSequence()
}

#HotIf

; ============================================================
; Repeating macro loop
; ============================================================
RunMacroSequence() {
    global gRunning, gStartTick, MAX_RUNTIME_MS, STEP_SLEEP_MS, CYCLE_PAUSE_MS
    cycle := 0

    CheckOrStop(stepText) {
        global gRunning, gStartTick, MAX_RUNTIME_MS
        if !gRunning
            return false

        elapsed := A_TickCount - gStartTick
        if elapsed > MAX_RUNTIME_MS
            return false

        ToolTip stepText "`nTime: "
            . FormatTimeMMSS(elapsed) " / "
            . FormatTimeMMSS(MAX_RUNTIME_MS)
        return true
    }

    while gRunning {
        cycle += 1

        ; 1) Ctrl+J
        if !CheckOrStop("Cycle " cycle " — Step 1/10: Ctrl+J") {
            StopMacro()
            return
        }
        Send "^j"
        Sleep STEP_SLEEP_MS

        ; 2) Alt+]
        if !CheckOrStop("Cycle " cycle " — Step 2/10: Alt+]") {
            StopMacro()
            return
        }
        Send "!]"
        Sleep STEP_SLEEP_MS

        ; 3) Delete
        if !CheckOrStop("Cycle " cycle " — Step 3/10: Delete") {
            StopMacro()
            return
        }
        Send "{Delete}"
        Sleep STEP_SLEEP_MS

        ; 4) Tap Alt
        if !CheckOrStop("Cycle " cycle " — Step 4/10: Tap Alt") {
            StopMacro()
            return
        }
        Send "{Alt}"
        Sleep STEP_SLEEP_MS

        ; 5) Right x5
        if !CheckOrStop("Cycle " cycle " — Step 5/10: Right x5") {
            StopMacro()
            return
        }
        Loop 5 {
            if !gRunning {
                StopMacro()
                return
            }
            Send "{Right}"
            Sleep 10
        }
        Sleep STEP_SLEEP_MS

        ; 6) Down x10
        if !CheckOrStop("Cycle " cycle " — Step 6/10: Down x10") {
            StopMacro()
            return
        }
        Loop 10 {
            if !gRunning {
                StopMacro()
                return
            }
            Send "{Down}"
            Sleep 10
        }
        Sleep STEP_SLEEP_MS

        ; 7) Enter x2
        if !CheckOrStop("Cycle " cycle " — Step 7/10: Enter x2") {
            StopMacro()
            return
        }
        Send "{Enter}"
        Sleep STEP_SLEEP_MS
        Send "{Enter}"
        Sleep STEP_SLEEP_MS

        ; 8) Delete
        if !CheckOrStop("Cycle " cycle " — Step 8/10: Delete") {
            StopMacro()
            return
        }
        Send "{Delete}"
        Sleep STEP_SLEEP_MS

        ; 9) Ctrl+S
        if !CheckOrStop("Cycle " cycle " — Step 9/10: Ctrl+S") {
            StopMacro()
            return
        }
        Send "^s"
        Sleep STEP_SLEEP_MS

        ; 10) Ctrl+W
        if !CheckOrStop("Cycle " cycle " — Step 10/10: Ctrl+W") {
            StopMacro()
            return
        }
        Send "^w"
        Sleep STEP_SLEEP_MS

        ; Pause between cycles
        Sleep CYCLE_PAUSE_MS
    }

    StopMacro()
}

; ============================================================
; Failsafe watchdog (total runtime since start)
; ============================================================
FailsafeStop() {
    global gRunning, gStartTick, MAX_RUNTIME_MS
    if !gRunning
        return
    if (A_TickCount - gStartTick) > MAX_RUNTIME_MS
        StopMacro("Stopped (failsafe) ⏱️")
}

; ============================================================
; Helpers
; ============================================================
StopMacro(msg := "Stopped.") {
    global gRunning
    gRunning := false
    SetTimer FailsafeStop, 0
    ToolTip msg
    SetTimer ClearToolTip, -1200
}

ClearToolTip() {
    ToolTip
}

FormatTimeMMSS(ms) {
    total := Floor(ms / 1000)
    return Format("{:02}:{:02}", Floor(total / 60), Mod(total, 60))
}
