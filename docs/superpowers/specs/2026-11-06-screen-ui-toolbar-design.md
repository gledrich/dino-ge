# Screen UI editing from the paintbrush

The action bar should let users enter Screen UI editing directly from the canvas. The paintbrush remains the primary scene-editing action. Hovering over its control group reveals a separate screen-shaped **Edit Screen UI** button directly above it. The pointer can move from the brush to the new button without closing it. Keyboard focus reveals the same button, and a small disclosure control makes it available on touchscreens while keeping a single tap on the brush assigned to scene editing.

The hover-up control is the requested approach. Two permanent toolbar icons would make both modes equally visible and take more room on mobile. A menu that opens on every brush click would fit the same space and add a click to the existing scene-editing flow.

Use the existing Screen UI editing session for the toolbar and Inspector. Users can start when the current game exposes Screen UI controls and select a control on the canvas. Entering Screen UI editing exits scene editing, restores the scene camera and keeps the game paused. The Screen UI button shows the active state and offers to finish the session. Pending changes still require Apply or Discard, and the existing Inspector entry point remains available.

The hosted Playground currently supports Screen UI editing and hides the world-editing brush. Show the Screen UI icon directly in the edit slot there until the shared canvas workspace enables the hosted brush. Once both actions are available, use the same control group.

Screen UI mode uses the same movable canvas controls panel as scene mode. Show Undo, Redo and Done alongside a short selection hint. Preview history covers move, resize, property changes and discard. Each pointer gesture is one edit, and cancellation restores its starting value. Applying an edit hands that control's history to Monaco and preserves preview history for other controls.

## Browser acceptance checks

- Move the pointer from the brush to the Screen UI icon without losing the target. Tab to the same action and press Escape to close the disclosure. Tap the chevron on a touch device and select Screen UI without toggling scene editing first.
- Start with no Explorer selection. Select a Screen UI control from the canvas and edit it through the existing Inspector. Try to leave with a pending edit, then discard it and finish successfully.
- Switch from scene editing after moving the camera. Confirm the camera restores and gameplay stays paused while Screen UI editing is active.
- On the hosted Playground, enter Screen UI editing from the action bar while the same preview stays loaded. Check that both action-bar variants fit within the visible canvas, including when the toolbar is near the top.
