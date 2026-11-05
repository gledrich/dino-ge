# Playground desktop docks

## Intent

Give people room to edit game code alongside the canvas, and let them put each tool where it best fits their workflow. The default desktop layout places Explorer on the left, Editor and Inspector on the right with Editor selected, and Console below the canvas. The canvas occupies the centre above Console.

## Approaches

The selected approach uses three fixed dock locations. Users can move and reorder tabs inside those locations. This keeps the workspace predictable and gives people direct control of which tools are visible. Splittable docks would make it possible to see several tools in one region, at the cost of more resize controls, more minimum-size conflicts and more steps to restore a familiar layout. The fixed docks are the agreed scope.

## Desktop behaviour

- Explorer, Editor, Inspector and Console each appear once. Explorer includes the scene hierarchy, Library and Assets.
- Drag a tab within its dock to reorder it, or drag it to another dock. Show where the tab will land. Give tab moves their own drag type so dragging Library objects, sprites or files continues to use the existing placement and import paths.
- Each tab has a keyboard-accessible move action. Moving it selects it in the destination and focuses it there. When the selected tab leaves a dock, select a remaining neighbour. An empty dock gives its space back to the workspace and remains a destination during a drag or keyboard move.
- Dock sizes are adjustable. Remember desktop tab positions, order, sizes and active tabs in the current browser. Validate the saved layout against the available tools, with defaults for missing or invalid entries. Provide a way to restore the default layout.
- An explicit action that opens a tool, such as View source, Reveal in Explorer, Review canvas changes or Open Console, selects that tab and opens its current dock. Ordinary object selection leaves the current tool in view. Closing a project-file dialog returns focus to its trigger if visible, or to the visible Editor tab.

## Mobile behaviour and state

- The existing responsive breakpoint shows all four tools in one resizable drawer over the bottom of the game. The game keeps the full window dimensions when the drawer resizes or collapses. Mobile tab selection and drawer size are independent of desktop settings. Returning to desktop restores the desktop arrangement.
- Preserve the active game, Monaco document and undo history, scene selection, pending placements, Explorer state and captured console output while moving tabs or switching layouts. The current stable portal hosts for Explorer and Inspector are a starting point for moving tool content without remounting it. Keep the viewport in the workspace throughout.
- Keep the existing touch placement grips, keyboard tab navigation and keyboard-accessible dock resize controls. The implementation can choose the drop indicator styling and minimum dock sizes using the Playground's existing design tokens and available canvas space.

## Verification and documentation

- In Chromium, Firefox and WebKit, verify the default arrangement, reorder and move a tab, move a tab into an empty dock, and restore the saved arrangement after a reload. Cover the keyboard move path and focus handoffs.
- Move the Editor and switch between desktop and mobile while a game is running and a draft has unsaved changes. Verify the game and document retain their identity, and verify undo, live Inspector feedback, Library placement, sprite placement and Console messages still work.
- Check the desktop arrangement at both sides of the mobile breakpoint and resize the mobile dock using touch emulation. Refresh the desktop overview, Editor and Inspector captures in the Playground README from the finished build.
