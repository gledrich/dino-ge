import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import express from "express";
import ts from "typescript";

const source = new URL("../../packages/playground/src/utils/", import.meta.url);
const app = express();
app.use("/templates", express.static(fileURLToPath(new URL("../../packages/playground/dist/templates", import.meta.url))));
app.get("/", (_request, response) => response.type("html").send("<!doctype html><title>Workspace check</title>"));
for (const name of ["browser-workspace", "browser-project-archive"]) {
  app.get("/" + name, async (_request, response) => {
    const { outputText } = ts.transpileModule(await readFile(new URL(name + ".ts", source), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext }
    });
    response.type("js").send(outputText);
  });
}
const server = await new Promise(resolve => {
  const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
});
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.DINO_PREVIEW_CHROMIUM });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:" + server.address().port);
  const imported = await page.evaluate(async () => {
    const { browserWorkspace } = await import("/browser-workspace");
    const files = new Map([
      ["src/main.js", new Blob(["initial"])],
      ["src/nested/logic.js", new Blob(["export const value = 1;"])],
      ["assets/relic.bin", new Blob([new Uint8Array([0, 42, 255])])]
    ]);
    const imports = await Promise.allSettled([
      browserWorkspace.importProject("relic", "src/main.js", files),
      browserWorkspace.importProject("relic", "src/main.js", files)
    ]);
    const unsafe = await browserWorkspace.importProject("unsafe", "src/main.js", new Map([
      ...files, ["../outside.js", new Blob([""])],
    ])).then(() => false, () => true);
    return { results: imports.map(result => result.status), unsafe, entries: await browserWorkspace.list() };
  });
  assert.deepEqual(imported, {
    results: ["fulfilled", "rejected"],
    unsafe: true,
    entries: ["relic/src/main"]
  });
  await page.reload();
  const saved = await page.evaluate(async () => {
    const { browserWorkspace } = await import("/browser-workspace");
    await Promise.all([
      browserWorkspace.writeScript("relic/src/main", " A", "append"),
      browserWorkspace.writeScript("relic/src/main", " B", "append"),
    ]);
    const snapshot = await browserWorkspace.snapshot("relic/src/main");
    return {
      code: await browserWorkspace.readScript("relic/src/main"),
      nested: await snapshot.files.get("src/nested/logic.js").text(),
      asset: Array.from(new Uint8Array(await snapshot.files.get("assets/relic.bin").arrayBuffer()))
    };
  });
  assert.deepEqual(saved, { code: "initial A B", nested: "export const value = 1;", asset: [0, 42, 255] });
  const backup = await page.evaluate(async () => {
    const { browserWorkspace } = await import("/browser-workspace");
    const { exportBrowserProject, restoreBrowserProject } = await import("/browser-project-archive");
    const entry = "relic/src/main";
    const modulePath = "src/nested/logic.js";
    const { revision } = await browserWorkspace.readModule(entry, modulePath);
    const updated = await browserWorkspace.saveModule(entry, modulePath, "export const value = 2;", revision);
    const conflict = await browserWorkspace.saveModule(entry, modulePath, "stale", revision);
    const png = await fetch("/templates/amber-ruins/assets/amber.png").then(response => response.blob());
    const upload = new File([png], "Amber Stone.png", { type: "image/png" });
    const imagePath = await browserWorkspace.importSprite(entry, upload);
    const duplicateImagePath = await browserWorkspace.importSprite(entry, upload);
    const listed = await browserWorkspace.listSprites(entry);
    const archive = await exportBrowserProject(entry);
    const restoredId = await restoreBrowserProject(archive);
    const restored = await browserWorkspace.snapshot(restoredId);
    return {
      changedRevision: updated !== revision,
      imageInEntryDirectory: /^src\/_dino-assets\/amber-stone-[a-f0-9]{64}\.png$/.test(imagePath),
      sameUpload: duplicateImagePath === imagePath,
      listedImages: listed.map(({ name, file }) => [name, file.type]),
      imageBytesMatch: new Uint8Array(await restored.files.get(imagePath).arrayBuffer()).toString() ===
        new Uint8Array(await png.arrayBuffer()).toString(),
      conflict,
      restoredId,
      entry: restored.entry,
      code: await restored.files.get(restored.entry).text(),
      nested: await restored.files.get(modulePath).text(),
      asset: Array.from(new Uint8Array(await restored.files.get("assets/relic.bin").arrayBuffer())),
    };
  });
  assert.deepEqual(backup, {
    changedRevision: true,
    imageInEntryDirectory: true,
    sameUpload: true,
    listedImages: [["amber-stone", "image/png"]],
    imageBytesMatch: true,
    conflict: null,
    restoredId: "relic-2/src/main",
    entry: "src/main.js",
    code: "initial A B",
    nested: "export const value = 2;",
    asset: [0, 42, 255],
  });
  const separate = await browser.newPage();
  await separate.goto(page.url());
  const starter = await separate.evaluate(async () => {
    const { browserWorkspace, seedBrowserWorkspace } = await import("/browser-workspace");
    const before = await browserWorkspace.list();
    await Promise.all([seedBrowserWorkspace(), seedBrowserWorkspace()]);
    const after = await browserWorkspace.list();
    const starter = await browserWorkspace.snapshot("amber-ruins/game");
    return { before, after, mapIncluded: starter.files.has("assets/rooms.tmj") };
  });
  assert.deepEqual(starter, { before: [], after: ["amber-ruins/game"], mapIncluded: true });
  console.log("Workspace seeds once, preserves nested and binary files across reloads and backup restore, isolates browser profiles, and rejects unsafe, duplicate and stale writes.");
} finally {
  await browser?.close();
  server.close();
}
