---
---
# 3. Draw and animate sprites

[Core guide](index.html)

A sprite sheet packs several frames into one image. Load the sheet, tell the sprite how it is divided, then play the frames you want.

[Run the demo](demos/drawing-and-animation/index.html) · [View the source](demos/drawing-and-animation/source.html)

Watch the explorer walk behind the pillar. **Toggle animation** stops the frames while the explorer keeps moving, so you can see how animation and position work independently.

```js
Loader.queueImage('explorer', import.meta.resolve('amber-assets/explorer-walk.png'));
await Loader.loadAll(percent => { status.textContent = `Loading ${Math.round(percent)}%`; });

const image = Loader.getImage('explorer');
explorer = new Sprite({
  tag: 'explorer', img: image, rows: 2, cols: 2,
  startCol: 0, endCol: 4, scale: 44 / (image.width / 2),
  position: new Vector2(24, 121), zIndex: 1,
});
explorer.play();
```

Queue assets by tag and await them before constructing sprites that use those tags. Resolve asset URLs with the demo's import map or with a URL relative to your module. Both work under the project's GitHub Pages path. Handle failures so a missing image does not leave a silent blank screen.

The sheet has two rows and two columns. The animation starts at frame 0 and stops before frame 4. Scaling by the width of one frame gives a 44-pixel sprite. The toggle changes `SpriteComponent.playing` to pause frame changes while keeping the sprite in the scene.

The pillar is a `Rectangle` with a higher `zIndex` than the explorer. The scene also uses a `Line` for the path, a `Circle` for a marker and `Text` for a sign. These objects all draw in world coordinates, so the camera affects them. A HUD uses screen coordinates instead.

Try lowering the pillar's `zIndex` below the explorer's and watch which object draws in front. The sprite sheet comes from Amber Ruins.

[Loader](../api/classes/core_Loader.ResourceLoader.html) · [Sprite](../api/classes/objects_Sprite.Sprite.html) · [Text](../api/classes/objects_Text.Text.html) · [Rectangle](../api/classes/objects_Rectangle.Rectangle.html) · [Circle](../api/classes/objects_Circle.Circle.html) · [Line](../api/classes/objects_Line.Line.html)
