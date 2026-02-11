; ============================================================
; BatchTiles.ahk (AutoHotkey v2)
; Batch-process PNG tiles in Photoshop using a UI-independent Action (F2)
;
; Hotkeys:
;   Ctrl+Alt+B  -> Start batch (sequential zoom 4 -> 5 -> 6)
;   Ctrl+Alt+P  -> Pause/Resume (pauses BETWEEN files)
;   Esc         -> Emergency kill (ExitApp)
;
; Features:
;   - Progress stats (overall + per-zoom), elapsed + ETA
;   - Resume support (skips paths already in processed_tiles.log)
;   - Sequential batching (4 then 5 then 6)
;   - UI-independent action execution (your Action bound to F2)
; ============================================================

SendMode "Input"
SetKeyDelay 30, 30
Esc::ExitApp

; ---------------------------
; Paths
; ---------------------------
ROOT := "C:\Users\casst\OneDrive\Desktop\ChatGPT map\tiles_loom_road"
PHOTOSHOP_EXE := "C:\Program Files\Adobe\Adobe Photoshop 2023\Photoshop.exe"

; ---------------------------
; Batch options
; ---------------------------
ZOOMS := [4, 5, 6]
PROCESSED_LOG := ROOT "\processed_tiles.log"  ; one full path per line

; ---------------------------
; Timing (tweak as needed)
; ---------------------------
OPEN_DIALOG_WAIT_MS := 4000
DOC_LOAD_WAIT_MS    := 500
BETWEEN_FILES_MS    := 150
ACTION_DELAY_MS     := 150   ; buffer after pressing F2
ACTION_HOTKEY       := "{F2}"

; ---------------------------
; State (pause/resume)
; ---------------------------
global gPaused := false
global gBatchRunning := false

; ============================================================
; Hotkeys
; ============================================================

^!b:: {  ; Ctrl+Alt+B
    global gBatchRunning, gPaused
    if gBatchRunning {
        ToolTip "Batch is already running."
        SetTimer ClearToolTip, -1200
        return
    }
    gBatchRunning := true
    gPaused := false
    try {
        Main()
    } finally {
        gBatchRunning := false
        gPaused := false
    }
}

^!p:: {  ; Ctrl+Alt+P
    global gPaused, gBatchRunning
    if !gBatchRunning {
        ToolTip "No batch is running."
        SetTimer ClearToolTip, -1200
        return
    }
    gPaused := !gPaused
    if gPaused {
        ToolTip "PAUSED — Press Ctrl+Alt+P to resume"
    } else {
        ToolTip "Resumed."
        SetTimer ClearToolTip, -800
    }
}

; ============================================================
; Main
; ============================================================
Main() {
    global ROOT, ZOOMS, PROCESSED_LOG, PHOTOSHOP_EXE
    global BETWEEN_FILES_MS

    EnsurePhotoshopRunning(PHOTOSHOP_EXE)

    processed := LoadProcessedSet(PROCESSED_LOG)
    stats := BuildQueues(ROOT, ZOOMS, processed)

    totalRemaining := stats.totalRemaining
    totalFound := stats.totalFound

    if (totalRemaining = 0) {
        ToolTip "Nothing to do.`nFound: " totalFound "`nAll already processed (resume log)."
        SetTimer ClearToolTip, -2500
        return
    }

    startTick := A_TickCount
    doneOverall := 0
    avgMsPerFile := 0

    for _, z in ZOOMS {
        q := stats.queues[z]
        totalZ := stats.totalPerZoom[z]  ; remaining-to-do in this zoom
        doneZ := 0

        for _, path in q {
            WaitIfPaused()

            ShowProgress(path, z, doneOverall, totalRemaining, doneZ, totalZ, startTick, avgMsPerFile)

            t0 := A_TickCount
            OpenFileInPhotoshop(path)
            RunPhotoshopAction()
            MarkProcessed(processed, PROCESSED_LOG, path)

            doneOverall += 1
            doneZ += 1

            dt := A_TickCount - t0
            avgMsPerFile := (avgMsPerFile = 0) ? dt : Round(avgMsPerFile * 0.85 + dt * 0.15)

            Sleep BETWEEN_FILES_MS
        }
    }

    ToolTip "Done ✅`nProcessed this run: " doneOverall "`nTotal found: " totalFound
    SetTimer ClearToolTip, -3000
}

; ============================================================
; Pause helper
; ============================================================
WaitIfPaused() {
    global gPaused
    while gPaused {
        Sleep 150
        ToolTip "PAUSED — Press Ctrl+Alt+P to resume"
    }
}

; ============================================================
; Queue building (resume-aware)
;   - totalFound counts ALL pngs discovered under zoom roots
;   - totalRemaining counts those NOT yet in processed log
;   - totalPerZoom[z] counts remaining-to-do in that zoom
; ============================================================
BuildQueues(root, zooms, processedSet) {
    totalFound := 0
    totalRemaining := 0
    queues := Map()
    totalPerZoom := Map()

    for _, z in zooms {
        q := []
        zoomRoot := root "\" z
        remainingZ := 0

        Loop Files, zoomRoot "\*.png", "R" {
            full := A_LoopFileFullPath
            totalFound += 1
            if !processedSet.Has(full) {
                q.Push(full)
                remainingZ += 1
                totalRemaining += 1
            }
        }

        queues[z] := q
        totalPerZoom[z] := remainingZ
    }

    return { queues: queues
           , totalPerZoom: totalPerZoom
           , totalFound: totalFound
           , totalRemaining: totalRemaining }
}

; ============================================================
; Progress tooltip (AHK v2-safe formatting)
; ============================================================
ShowProgress(path, zoom, doneOverall, totalRemaining, doneZ, totalZ, startTick, avgMsPerFile) {
    elapsed := A_TickCount - startTick
    elapsedStr := FormatTimeHHMMSS(elapsed)

    overallPct := (totalRemaining > 0) ? Floor((doneOverall * 100) / totalRemaining) : 100
    zoomPct := (totalZ > 0) ? Floor((doneZ * 100) / totalZ) : 100

    etaStr := "—"
    if (avgMsPerFile > 0) {
        remaining := totalRemaining - doneOverall
        if (remaining < 0)
            remaining := 0
        etaStr := FormatTimeHHMMSS(remaining * avgMsPerFile)
    }

    msg :=
        "Zoom " zoom " progress: " doneZ "/" totalZ " (" zoomPct "%)`n"
      . "Overall: " doneOverall "/" totalRemaining " (" overallPct "%)`n"
      . "Elapsed: " elapsedStr "   ETA: " etaStr "`n`n"
      . path

    ToolTip msg
}

FormatTimeHHMMSS(ms) {
    total := Floor(ms / 1000)
    hh := Floor(total / 3600)
    mm := Floor(Mod(total, 3600) / 60)
    ss := Mod(total, 60)
    return Format("{:02}:{:02}:{:02}", hh, mm, ss)
}

ClearToolTip() {
    ToolTip
}

; ============================================================
; Resume log helpers
; ============================================================
LoadProcessedSet(logPath) {
    s := Map()
    if !FileExist(logPath)
        return s

    txt := FileRead(logPath, "UTF-8")
    for line in StrSplit(txt, "`n", "`r") {
        if (line != "")
            s.Set(line, true)
    }
    return s
}

MarkProcessed(processedSet, logPath, fullPath) {
    if processedSet.Has(fullPath)
        return
    processedSet.Set(fullPath, true)
    FileAppend fullPath "`n", logPath, "UTF-8"
}

; ============================================================
; Photoshop control
; ============================================================
EnsurePhotoshopRunning(psPath) {
    if WinExist("ahk_exe Photoshop.exe") {
        WinActivate "ahk_exe Photoshop.exe"
        WinWaitActive "ahk_exe Photoshop.exe", , 3
        return
    }
    Run psPath
    WinWait "ahk_exe Photoshop.exe", , 20
    WinActivate "ahk_exe Photoshop.exe"
    WinWaitActive "ahk_exe Photoshop.exe", , 20
}

OpenFileInPhotoshop(fullPath) {
    global OPEN_DIALOG_WAIT_MS, DOC_LOAD_WAIT_MS

    WinActivate "ahk_exe Photoshop.exe"
    WinWaitActive "ahk_exe Photoshop.exe", , 3

    Send "^o"

    ; Standard Windows Open dialog is typically class #32770
    if !WinWaitActive("ahk_class #32770", , OPEN_DIALOG_WAIT_MS/1000) {
        ToolTip "Open dialog didn't appear. Skipping:`n" fullPath
        SetTimer ClearToolTip, -2000
        return
    }

    ClipSaved := A_Clipboard
    A_Clipboard := fullPath
    Sleep 50
    Send "^v"
    Sleep 50
    Send "{Enter}"
    Sleep 50
    A_Clipboard := ClipSaved

    WinWaitActive "ahk_exe Photoshop.exe", , 10
    Sleep DOC_LOAD_WAIT_MS
}

RunPhotoshopAction() {
    global ACTION_HOTKEY, ACTION_DELAY_MS
    WinActivate "ahk_exe Photoshop.exe"
    WinWaitActive "ahk_exe Photoshop.exe", , 3
    Send ACTION_HOTKEY
    Sleep ACTION_DELAY_MS
}
