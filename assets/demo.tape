# RonDO (OpenTUI) demo
#
#   bun run build
#   PATH="$PWD/dist:$PATH" vhs assets/demo.tape
#
# The tape seeds a throwaway profile in /tmp/rondo-demo so the recording always
# shows the same data, then drives the interface with the keyboard.

Output assets/demo.gif

Set Shell bash
Set Width 1360
Set Height 660
Set FontSize 15
Set Padding 18
Set TypingSpeed 45ms
Set Theme { "name": "RonDO", "background": "#0b0d13", "foreground": "#e8ecf5", "cursor": "#22d3ee", "selection": "#1b2333", "black": "#11141d", "red": "#fb7185", "green": "#34d399", "yellow": "#fbbf24", "blue": "#60a5fa", "magenta": "#a78bfa", "cyan": "#22d3ee", "white": "#e8ecf5", "brightBlack": "#5d6780", "brightRed": "#fb7185", "brightGreen": "#34d399", "brightYellow": "#fbbf24", "brightBlue": "#60a5fa", "brightMagenta": "#a78bfa", "brightCyan": "#22d3ee", "brightWhite": "#ffffff" }

# ─── Setup (hidden) ───
Hide
Type "export RONDO_HOME=/tmp/rondo-demo PS1='$ ' && scripts/demo-seed.sh >/dev/null && clear"
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
Sleep 800ms
Down
Sleep 800ms
Down 4
Sleep 2s
Screenshot assets/tasks.png
Sleep 1.2s

# ─── Read a task: subtasks, notes, time logs ───
Right
Sleep 1.2s
Down
Sleep 600ms
Space
Sleep 1.8s
Left
Sleep 1s

# ─── Live fuzzy filter ───
Type "/"
Sleep 600ms
Type "land"
Sleep 2s
Escape
Sleep 1.2s

# ─── Tag filter bar ───
Type "#"
Sleep 2.5s
Type "#"
Sleep 800ms

# ─── Create a task in the form: textarea, dates, segmented controls ───
Type "a"
Sleep 1.2s
Type "Ship the 2.0 release"
Sleep 400ms
Tab
Sleep 400ms
Type "Tag, publish the binaries and update the tap."
Enter
Type "- macOS + Linux"
Sleep 1s
Tab
Sleep 400ms
Type "2026-09-05"
Sleep 600ms
Tab
Sleep 300ms
Type "release, ops"
Sleep 600ms
Tab
Sleep 400ms
Right
Right
Right
Sleep 1.5s
Ctrl+S
Sleep 2s

# ─── Add a subtask ───
Type "t"
Sleep 1s
Type "Write the changelog"
Sleep 500ms
Enter
Sleep 1.8s

# ─── Cycle a status ───
Space
Sleep 1.5s

# ─── Sort order ───
Type "o"
Sleep 1.5s

# ─── Command palette ───
Ctrl+K
Sleep 1s
Type "focus"
Sleep 1.5s
Enter
Sleep 2s

# ─── Statistics ───
Type "S"
Sleep 3s
Escape
Sleep 800ms

# ─── Journal ───
Tab
Sleep 600ms
Tab
Sleep 600ms
Tab
Sleep 2s
Screenshot assets/journal.png
Sleep 1.5s
Type "a"
Sleep 1s
Type "Shipped the OpenTUI port. Mouse, overlays and a command palette."
Sleep 700ms
Ctrl+S
Sleep 2.5s

# ─── Help ───
Type "?"
Sleep 3s
Escape
Sleep 800ms

# ─── Light theme ───
Tab
Sleep 600ms
Type "T"
Sleep 2.5s
Type "T"
Sleep 1.5s

Type "q"
Sleep 1s
