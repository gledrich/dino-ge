import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const { chromium, firefox, webkit } = require("@playwright/test");
const engine = process.env.DINO_PREVIEW_BROWSER ?? "chromium";
const browserType = { chromium, firefox, webkit }[engine];
if (!browserType) throw new Error("Choose chromium, firefox or webkit.");
const express = require("express");
const ts = require("typescript");

function start(app) {
  return new Promise(resolve => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const previewApp = express();
previewApp.use("/built", express.static("packages/dino-ge/dist"));
previewApp.use(express.static("website/preview"));
const preview = await start(previewApp);
const previewOrigin = "http://127.0.0.1:" + preview.address().port;
const editorApp = express();
editorApp.get("/", (req, res) => res.type("html").send("<!doctype html><title>Editor</title>"));
for (const name of ["browser-preview", "LogManager"]) {
  const source = readFileSync(`packages/playground/src/utils/${name}.ts`, "utf8");
  const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
  editorApp.get("/" + name, (_request, response) => response.type("js").send(compiled));
}
const editor = await start(editorApp);
const editorOrigin = "http://localhost:" + editor.address().port;
let browser;
try {
  browser = await browserType.launch({
    executablePath: process.env.DINO_PREVIEW_CHROMIUM
  });
  const page = await browser.newPage();
  page.on("console", msg => console.log(msg.text()));
  page.on("pageerror", error => console.log(error.message));
  await page.goto(editorOrigin);
  async function run(value, previous) {
    return page.evaluate(async ({ origin, value, previous }) => {
      window.activePreview?.dispose();
      const { startBrowserPreview, browserPreviewScene } = await import("/browser-preview");
      window.previewScene = browserPreviewScene;
      const js = content => new Blob([content], { type: "text/plain" });
      const files = new Map([
        ["src/main.js", js(`
          import { Circle, Engine, Vector2 } from "dino-ge";
          import { label } from "./nested/helper.js";
          export function then(resolve) {
            document.documentElement.dataset.unexpectedThen = "called";
            resolve();
          }
          const asset = await fetch(new URL("../assets/relic.txt", import.meta.url)).then(r => r.text());
          let parentBlocked = false;
          try { parent.localStorage.getItem("editor-secret"); } catch { parentBlocked = true; }
          const previousStatus = ${JSON.stringify(previous)} ?
            await fetch(${JSON.stringify(previous)} + "assets/relic.txt").then(r => r.status) : null;
          let workerBlocked = false;
          try { await navigator.serviceWorker.register("/worker.js?attempt"); } catch { workerBlocked = true; }
          console.info("Game " + label);
          new Engine({ onLoad: () => { new Circle({ tag: "Relay object", radius: 10, position: new Vector2(5, 8) }); } },
            { containerId: "playground-canvas-container" });
          parent.postMessage({ type: "result", siblingCount: parent.length, workerBlocked, value: label + ":" + asset + ":" + new Vector2(3, 4).magnitude, parentBlocked, previousStatus }, "*");
        `)],
        ["src/nested/helper.js", js("export const label = " + JSON.stringify(value))],
        ["assets/relic.txt", new Blob(["amber"], {type: "text/plain"})]
      ]);
      return new Promise((resolve, reject) => {
        function result(event) {
          const frame = document.querySelector('iframe[title="Isolated game preview"]');
          if (event.origin !== origin || event.source !== frame?.contentWindow || event.data?.type !== "result") return;
          window.removeEventListener("message", result);
          resolve({ url: frame.src, ...event.data });
        }
        window.addEventListener("message", result);
        window.activePreview = startBrowserPreview(document.body, origin + "/broker.html",
          { files, entry: "src/main.js" }, { paused: true, debug: true }, message => {
            window.removeEventListener("message", result);
            reject(new Error(message));
          });
      });
    }, { origin: previewOrigin, value, previous });
  }

  const first = await run("first");
  const second = await run("second", first.url);
  assert.equal(first.value, "first:amber:5");
  assert.equal(second.value, "second:amber:5");
  assert.equal(second.parentBlocked, true);
  assert.equal(second.previousStatus, 404);
  assert.equal(second.siblingCount, 1);
  assert.equal(second.workerBlocked, true);
  await page.waitForFunction(() => window.previewScene.getSnapshot().objects.some(object => object.tag === "Relay object"));
  const activeGame = page.frame({ url: second.url });
  assert.equal(await activeGame.locator('html').getAttribute('data-unexpected-then'), null);
  await page.evaluate(() => window.previewScene.select(window.previewScene.getSnapshot().objects[0].id));
  await page.waitForFunction(() => window.previewScene.getSnapshot().selectedId);
  await page.evaluate(() => {
    const { selectedId } = window.previewScene.getSnapshot();
    window.previewScene.transform(selectedId, "x", 42);
  });
  await page.waitForFunction(() => window.previewScene.getSnapshot().objects[0]?.x === 42);
  assert.ok(await page.evaluate(async () => {
    const { playgroundLogs } = await import("/LogManager");
    return playgroundLogs.getSnapshot().some(entry => entry.message === "Game second");
  }));
  if (engine === "chromium") {
    const devtools = await page.context().newCDPSession(page);
    await devtools.send("ServiceWorker.enable");
    await devtools.send("ServiceWorker.stopAllWorkers");
    const game = page.frame({ url: second.url });
    assert.equal(await game.evaluate(async () => {
      return fetch("./assets/relic.txt", { cache: "no-store" }).then(response => response.text());
    }), "amber");
  }
  console.log(`Isolated previews load nested modules and assets and relay scene edits and console messages in ${engine}.`);
  if (engine === "chromium") console.log("The active game also survived a worker restart.");
} finally {
  await browser?.close();
  preview.close();
  editor.close();
}
