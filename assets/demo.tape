# RonDO (OpenTUI) demo
#
#   bun run build
#   PATH="$PWD/dist:$PATH" vhs assets/demo.tape
#
# The tape seeds a fresh throwaway profile so the recording always
# shows the same data, then drives the interface with the keyboard.

Output assets/demo.gif

Set Shell bash
Set Width 1360
Set Height 660
Set FontSize 15
Set Padding 18
Set TypingSpeed 45ms
Set Theme { "name": "RonDO", "background": "#1e1e1e", "foreground": "#e4e4e4", "cursor": "#22d3ee", "selection": "#2b3b41", "black": "#252526", "red": "#fb7185", "green": "#4ade80", "yellow": "#fbbf24", "blue": "#60a5fa", "magenta": "#c5a5ff", "cyan": "#22d3ee", "white": "#e4e4e4", "brightBlack": "#7a7a7a", "brightRed": "#fb7185", "brightGreen": "#4ade80", "brightYellow": "#fbbf24", "brightBlue": "#60a5fa", "brightMagenta": "#c5a5ff", "brightCyan": "#22d3ee", "brightWhite": "#ffffff" }

# ─── Setup (hidden) ───
Hide
Type "export RONDO_HOME=$(mktemp -d /tmp/rondo-demo.XXXXXX) PS1='$ ' && scripts/demo-seed.sh >/dev/null && clear"
Enter
Sleep 2s
Show

# ─── Launch ───
Type "rondo-opentui"
Sleep 400ms
Enter
Sleep 3s

# ─── Move through the list; the detail panel follows ───
Down
Sleep 700ms
Down
Sleep 700ms
Down
Sleep 1.5s
Screenshot assets/tasks.png
Sleep 1s

# ─── Read a task: subtasks, notes, time logs ───
Right
Sleep 1.2s
Down
Sleep 500ms
Space
Sleep 1.5s
Left
Sleep 800ms

# ─── Live fuzzy filter ───
Type "/"
Sleep 500ms
Type "search"
Sleep 1.8s
Escape
Sleep 1.2s

# ─── Tag picker (# opens it; typing narrows, enter applies) ───
Type "#"
Sleep 1s
Type "front"
Sleep 1.2s
Enter
Sleep 1.8s
Type "#"
Sleep 800ms
Enter
Sleep 1s

# ─── Quick-add: tokens set tag, due, priority and recurrence inline ───
Type "a"
Sleep 1s
Type "Ship the 2.0 release #release @tomorrow !high ~w"
Sleep 1.5s
Tab
Sleep 400ms
Type "Tag, publish the binaries and update the tap."
Sleep 1s
Ctrl+N
Sleep 1s
Type "Publish the release notes #docs"
Enter
Sleep 2s

# ─── One key completes the task just created ───
Space
Sleep 1.5s

# ─── Direct triage: priority and due without opening the form ───
Down
Sleep 500ms
Type "+"
Sleep 1.2s
Type "@"
Sleep 800ms
Type "m"
Sleep 1.5s

# ─── Cycle views: all → today → overdue ───
Type "v"
Sleep 1.2s
Type "v"
Sleep 1.8s

# ─── Extend a range, then select every visible task ───
Type "J"
Sleep 800ms
Type "M"
Sleep 500ms
Space
Sleep 1.5s
Type "u"
Sleep 1.8s

# ─── Command palette: jump straight to a task ───
Ctrl+K
Sleep 800ms
Type "landing"
Sleep 1.2s
Enter
Sleep 1.8s
Backspace
Sleep 1s

# ─── Statistics ───
Type "S"
Sleep 2.5s
Escape
Sleep 800ms

# ─── Journal ───
Type "4"
Sleep 1.8s
Screenshot assets/journal.png
Sleep 1.2s
Type "a"
Sleep 1s
Type "Shipped the OpenTUI port. Mouse, overlays and a command palette."
Sleep 700ms
Ctrl+S
Sleep 2s
Type "/"
Type "wireframes"
Enter
Sleep 1.5s
Type "}"
Sleep 800ms
Escape
Escape

# ─── Help ───
Type "?"
Sleep 2.8s
Escape
Sleep 700ms

# ─── Light theme ───
Type "1"
Sleep 500ms
Type "T"
Sleep 2s
Type "T"
Sleep 1.2s
Type '\'
Sleep 1s
Type '\'
Sleep 1s

# Quit; confirm if a focus session is still running.
Type "q"
Sleep 1.5s
Type "y"
Sleep 1s
