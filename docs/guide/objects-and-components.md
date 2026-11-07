---
---
# 2. Compose objects with components

[Core guide](index.html)

A `GameObject` is something in the game, such as a sign, an enemy or a pickup. A **component** holds one piece of its state, such as position or visibility. A **system** processes objects with the components it needs. The engine runs the built-in rendering and physics systems; you call your own system from an update callback.

[Run the demo](demos/objects-and-components/index.html) · [View the source](demos/objects-and-components/source.html)

Select **Move sign**. The board and marker move together. Select **Toggle marker**. The sign stays visible while the marker disappears.

## Build the sign

Keep the `<head>` from the [first scene](first-scene.html). Replace the contents of `<body>` with the following:

```html
<div id="game" style="width: 360px; max-width: 100%; height: 220px"></div>
<button id="move">Move sign</button>
<button id="toggle">Toggle marker</button>
<p id="status" role="status"></p>
```

Save this as `main.js`. Follow `pin` from its creation, through `pin.addComponent(marker)`, to the call to `markers.update(Engine.objects)` on each frame.

```js
{% include_relative demos/objects-and-components/main.js %}
```

This example has no active scene, so built-in objects register in `Engine.objects`. If you use a scene, pass its `objects` set to the system instead. The system ignores objects without `Marker` and copies the marker's state to the circle's built-in `VisibilityComponent`.

The HTML button listens for a browser click and calls `sign.emit('toggle-marker')`. The sign's `sign.on('toggle-marker', ...)` handler changes the component's data, which the system applies on the next update. To remove a listener with `object.off()`, pass the same function you registered. The static `Engine.on()`, `Engine.emit()` and `Engine.off()` methods handle game-wide events.

The sign is a `Group`, a non-drawing object with a transform. `sign.transform.addChild(pin.transform)` makes the pin's position relative to the sign. The pin's local position stays the same when the sign moves. Its world position changes. Positions, scales and offsets use `Vector2`. Rotation is in radians.

Tags help identify objects, bounds describe their extent and visibility determines whether they draw. Built-in objects configure the components they need, so you can begin with `Sprite`, `Rectangle` or `Circle` and add capabilities as needed.

Change the board's `new Vector2(0, 0)` to `new Vector2(10, 0)` and reload. The board moves 10 pixels to the right of the sign's origin, but the pin's local offset stays the same.

[GameObject](../api/classes/core_GameObject.GameObject.html) · [Group](../api/classes/core_Group.Group.html) · [Component](../api/classes/core_Component.Component.html) · [System](../api/classes/core_System.System.html) · [Transform](../api/classes/components_TransformComponent.TransformComponent.html) · [Vector2](../api/classes/math_Vector2.Vector2.html)
