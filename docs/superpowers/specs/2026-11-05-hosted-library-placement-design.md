# Hosted Playground Library placement

Proposed design for live canvas placement.

## Intent

Give the hosted Playground the same Library workflow as the local Playground. A person can place a shape or sprite into a running game, see it immediately, and save the corresponding source edit with the project. The editor and game remain on separate origins.

## Approaches

- Add a typed placement command to the existing preview bridge. The running game supplies the world position, creates the object and confirms the result. The editor prepares and applies the source change using its existing placement rules. This keeps the game instance alive and is the proposed approach.
- Regenerate the project snapshot and start a new game after each drop. This would reuse the current launch path, but every placement would reset game state and rerun startup code.

## Interaction

- Give shapes and sprites the same click, mouse drag, touch grip and keyboard placement affordances as the local Library. Use the visible portion of the canvas for placement and keep the mobile drawer above it. During a Library drag, an editor-side drop target over the exposed canvas receives native drag events that would otherwise enter the cross-origin frame. Show a drop guide while positioning. Keep the separate Code or Insert action for source-only insertion.
- A successful placement displays the object in the current game, selects it in Explorer, and inserts one undoable draft edit. The user saves through the normal project flow. Undo and redo keep the current preview and draft in sync. A rerun recreates the saved objects through the game script.
- When the current scene or source revision cannot be matched, show a specific placement error and preserve the draft and game. Use the existing source placement rules for an editable Engine setup or a verified scene class.

## Preview and source coordination

- Resolve the drop against the current frame and its exposed canvas. The preview reports the actual canvas rectangle independently of Screen UI so the editor can clip the drop target to the drawer and exclude the touch arrows and other controls. Send normalised canvas coordinates and calculate world coordinates inside the preview using the camera and backing canvas dimensions. The preview returns a placement handle bound to the run and the current scene instance.
- Reuse the local placement source checks for an editable Engine entry or a named scene declared in that entry. Identify the active scene using metadata added from verified source. Preserve source-location mappings for the Screen UI Inspector if the runtime entry is instrumented. Scene classes from other modules need verified module source support before the editor can offer source-backed placement there.
- The editor prepares the source edit and checks its revision before asking the preview to create an object. The preview accepts a bounded, allow-listed shape or sprite description from its verified parent and rejects a placement handle if the active scene changed. Use the tag and defaults from the prepared source edit for the preview object. Return only the acknowledgement and object identity needed to finish the placement. Include the selected placement in the bounded Explorer snapshot even when the scene exceeds its limit.
- Apply the prepared draft edit after the preview confirms creation and the run and draft are still current. Make repeated requests with the same handle idempotent. If the editor cancels, times out or changes revision, roll back the temporary object even if its acknowledgement arrives late. Remove it from the original scene collection if the game has since changed scenes. Keep undo and redo scoped to the original placement and scene, and reject stale handles when a frame is replaced.
- Give temporary objects an expiry in the preview and finalise them explicitly after the editor applies the draft. Retry finalisation by handle. If synchronisation cannot be confirmed after the draft changes, preserve any later edits and show that the game needs a rerun to pick up the draft.
- Use project-owned sprite images. Existing project asset paths remain relative to the script. For an image added after the current game started, send its validated image bytes and release any temporary URL when it is no longer needed. Recheck the placement handle and scene after image decode.

## Verification

Check that shapes and sprites can be dropped into a running hosted game and inserted as code on desktop. Check touch and keyboard placement, camera zoom and movement, an open or collapsed mobile drawer, and a game with a named scene. Check live feedback, exact source placement, undo, redo, save and reload. Exercise a stale draft or frame during placement and confirm both sides remain consistent. Keep the local Library and hosted release checks green.
