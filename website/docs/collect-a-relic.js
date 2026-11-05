import { Circle, Engine, Input, Vector2 } from "dino-ge";

const playerRadius = 14;
const relicRadius = 10;
const start = new Vector2(42, 88);
const goal = new Vector2(235, 88);
const status = document.querySelector("#relic-status");
let player;
let relic;
let collected = false;

function reset() {
  player.transform.position.copy(start);
  if (!relic) {
    relic = new Circle({
      tag: "relic",
      position: goal.clone(),
      radius: relicRadius,
      colour: "#ffc46f"
    });
  }
  collected = false;
  status.textContent = "Collect the amber relic.";
}

new Engine({
  onLoad() {
    player = new Circle({
      tag: "explorer",
      position: start.clone(),
      radius: playerRadius,
      colour: "#93dcc2"
    });
    reset();
    document.querySelector("#reset").addEventListener("click", () => {
      reset();
      document.querySelector("#relic-game").focus();
    });
  },
  update() {},
  fixedUpdate() {
    if (collected || document.activeElement?.id !== "relic-game") return;

    const x = Number(Input.isKeyDown("ArrowRight")) - Number(Input.isKeyDown("ArrowLeft"));
    const y = Number(Input.isKeyDown("ArrowDown")) - Number(Input.isKeyDown("ArrowUp"));
    if (!x && !y) return;

    const step = new Vector2(x, y).normalize().multiply(2);
    const position = player.transform.position;
    position.set(
      Math.max(16, Math.min(264, position.x + step.x)),
      Math.max(16, Math.min(160, position.y + step.y))
    );

    if (Vector2.distance(position, goal) <= playerRadius + relicRadius) {
      Engine.destroyObject(relic);
      relic = undefined;
      collected = true;
      status.textContent = "Relic collected!";
    }
  }
}, {
  title: "Collect a relic",
  containerId: "relic-game",
  width: "280px",
  height: "176px",
  backgroundColour: "#27251f"
});
