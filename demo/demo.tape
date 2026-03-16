Output demo/mnemon-demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 900
Set Height 580
Set Theme "Catppuccin Mocha"
Set WindowBar "Colorful"
Set WindowBarSize 40
Set BorderRadius 8
Set Padding 20
Set Framerate 15
Set TypingSpeed 40ms
Set CursorBlink false

# Hidden setup
Hide
Type "cd /Users/nikitagorokhov/dev/mnemon/mnemon-mcp && clear" Enter
Sleep 1s
Show

# Run demo
Type "bash demo/demo.sh"
Sleep 500ms
Enter

# Wait for script to finish (~6.5s with pauses)
Sleep 9s

# Hold final frame for readability
Sleep 4s
