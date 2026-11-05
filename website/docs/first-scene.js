import { Circle, Engine, Vector2 } from "dino-ge";

new Engine({
  onLoad: () => {
    new Circle({
      position: new Vector2(96, 96),
      radius: 28,
      colour: "#ffc46f"
    });
  },
  update() {}
}, {
  title: "Quickstart | Dino GE",
  width: "100%",
  height: "100%",
  containerId: "first-scene"
});
