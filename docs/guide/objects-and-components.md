---
---
# 2. Compose objects with components

[Core guide](index.html)

A `GameObject` is an entity. Components attach data and capabilities to it. A system reads or updates objects with particular components. Dino GE runs its own rendering and physics systems. The demo calls its custom system from the game callback.

[Run the demo](demos/objects-and-components/index.html) · [View the source](demos/objects-and-components/source.html)

Select **Move sign**. The board and marker move together. Select **Toggle marker**. The sign stays visible while the marker disappears.

```js
class Marker extends Component {
  visible = true;
}

class MarkerSystem extends System {
  update(objects) {
    for (const object of objects) {
      const marker = object.getComponent(Marker);
      if (marker) object.getComponent(VisibilityComponent).visible = marker.visible;
    }
  }
}
```

The marker starts as an ordinary circle. Adding `Marker` opts it into the custom system. The system copies the marker's state to the circle's built-in `VisibilityComponent`. Object events connect the button to a named action on the sign. Use `object.on()`, `object.emit()` and `object.off()` for object events, and the corresponding static `Engine` methods for game-wide events.

The sign is a `Group`, a non-drawing object with a transform. `sign.transform.addChild(pin.transform)` makes the pin's position relative to the sign. The pin's local position stays the same when the sign moves. Its world position changes. Positions, scales and offsets use `Vector2`. Rotation is in radians.

Tags help identify objects, bounds describe their extent and visibility determines whether they draw. Built-in objects configure the components they need, so you can begin with `Sprite`, `Rectangle` or `Circle` and add capabilities as needed.

Try moving the board independently of the marker by changing the board's local position.

[GameObject](../api/classes/core_GameObject.GameObject.html) · [Group](../api/classes/core_Group.Group.html) · [Component](../api/classes/core_Component.Component.html) · [System](../api/classes/core_System.System.html) · [Transform](../api/classes/components_TransformComponent.TransformComponent.html) · [Vector2](../api/classes/math_Vector2.Vector2.html)
