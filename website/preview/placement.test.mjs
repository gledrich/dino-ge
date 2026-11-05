import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Engine, Rectangle, Scene, Vector2 } from 'dino-ge';
import { createPlacementController } from './placement.js';

class Level extends Scene {
  static __dinoPlaygroundSceneSource = { scriptId: 'test/game', className: 'Level' };
}

const canvas = { width: 400, height: 200, getBoundingClientRect: () => ({ x: 8, y: 12, width: 300, height: 150 }) };
const makeController = () => createPlacementController(() => canvas, () => {});
const rectangle = { kind: 'Rectangle', tag: 'Test rectangle', options: { width: 80, height: 48, colour: '#54d6ad' } };
const prepare = controller => controller.command({ action: 'prepare', point: { x: 0.5, y: 0.25 } });

afterEach(() => {
  Engine.currentScene = null;
  Engine.objects.clear();
  Engine.camera.reset();
});

test('prepares a source-backed world position and creates the object only once per handle', async () => {
  const scene = new Level();
  Engine.currentScene = scene;
  Engine.camera.position.x = -40;
  Engine.camera.position.y = 15;
  Engine.camera.zoom = 2;
  const controller = makeController();
  const { handle, x, y, scene: source } = await prepare(controller);
  assert.deepEqual({ x, y, source }, {
    x: 60, y: 40, source: { scriptId: 'test/game', className: 'Level' },
  });
  const command = { action: 'create', handle, object: rectangle };
  const [first, second] = await Promise.all([controller.command(command), controller.command(command)]);
  assert.equal(first.id, second.id);
  const [object] = scene.objects;
  assert.equal(scene.objects.size, 1);
  assert.equal(object.id, first.id);
  assert.equal(object.transform.position.x, 60);
  assert.equal(object.transform.position.y, 40);
  assert.equal(Engine.selectedObject, object);
  await controller.command({ action: 'finalise', handle });
  await controller.command({ action: 'finalise', handle });
});

test('finalisation, undo and redo affect the original scene after switching scenes', async () => {
  const original = new Level();
  Engine.currentScene = original;
  const controller = makeController();
  const { handle } = await prepare(controller);
  const { id } = await controller.command({ action: 'create', handle, object: rectangle });
  const next = new Level();
  Engine.currentScene = next;
  await controller.command({ action: 'finalise', handle });
  await controller.command({ action: 'visibility', handle, visible: false });
  assert.equal(original.objects.size, 0);
  await controller.command({ action: 'visibility', handle, visible: true });
  assert.equal([...original.objects][0].id, id);
  assert.equal(next.objects.size, 0);
});

test('cancellation removes a temporary object from the scene that owns it', async () => {
  const original = new Level();
  Engine.currentScene = original;
  const controller = makeController();
  const { handle } = await prepare(controller);
  await controller.command({ action: 'create', handle, object: rectangle });
  Engine.currentScene = new Level();
  await controller.command({ action: 'cancel', handle });
  assert.equal(original.objects.size, 0);
  await assert.rejects(controller.command({ action: 'create', handle, object: rectangle }));
});

test('rejects out-of-canvas positions and creation after the prepared scene changes', async () => {
  Engine.currentScene = new Level();
  const controller = makeController();
  await assert.rejects(controller.command({ action: 'prepare', point: { x: 1.1, y: 0.5 } }));
  const { handle } = await prepare(controller);
  const next = new Level();
  Engine.currentScene = next;
  await assert.rejects(controller.command({ action: 'create', handle, object: rectangle }));
  assert.equal(next.objects.size, 0);
  await controller.command({ action: 'cancel', handle });
});

test('rolls back when selecting the placement changes the active scene', async t => {
  const next = new Level();
  Engine.currentScene = next;
  const nextSelection = new Rectangle({ tag: 'Existing object', width: 20, height: 20, position: new Vector2(0, 0) });
  const original = new Level();
  Engine.currentScene = original;
  const controller = makeController();
  const { handle } = await prepare(controller);
  const switchSceneOnSelection = ({ detail }) => {
    if (detail?.metadata.tag !== rectangle.tag) return;
    Engine.currentScene = next;
    Engine.selectedObject = nextSelection;
  };
  Engine.on('selectedObjectChanged', switchSceneOnSelection);
  t.after(() => Engine.off('selectedObjectChanged', switchSceneOnSelection));
  t.after(() => controller.command({ action: 'cancel', handle }));

  await assert.rejects(controller.command({ action: 'create', handle, object: rectangle }), /active scene changed/);
  assert.equal(original.objects.size, 0);
  assert.equal(next.objects.size, 1);
  assert.equal(Engine.selectedObject, nextSelection);
});

test('rolls back a registration in an intermediate scene when construction switches scenes', async t => {
  const original = new Level();
  const intermediate = new Level();
  const next = new Level();
  Engine.currentScene = original;
  const controller = makeController();
  const { handle } = await prepare(controller);
  const stop = Engine.observeObjectCreation(() => { Engine.currentScene = intermediate; });
  const switchAfterRegistration = () => {
    if (Engine.currentScene === intermediate && intermediate.objects.size) Engine.currentScene = next;
  };
  Engine.on('sceneHierarchyChanged', switchAfterRegistration);
  t.after(stop);
  t.after(() => Engine.off('sceneHierarchyChanged', switchAfterRegistration));

  await assert.rejects(controller.command({ action: 'create', handle, object: rectangle }), /active scene changed/);
  assert.equal(Engine.currentScene, next);
  assert.equal(original.objects.size, 0);
  assert.equal(intermediate.objects.size, 0);
  assert.equal(next.objects.size, 0);
});

test('rolls back when construction queues a scene switch before acknowledgement', async t => {
  const original = new Level();
  const next = new Level();
  Engine.currentScene = original;
  const controller = makeController();
  const { handle } = await prepare(controller);
  const stop = Engine.observeObjectCreation(() => queueMicrotask(() => { Engine.currentScene = next; }));
  t.after(stop);
  t.after(() => controller.command({ action: 'cancel', handle }));

  await assert.rejects(controller.command({ action: 'create', handle, object: rectangle }), /active scene changed/);
  assert.equal(Engine.currentScene, next);
  assert.equal(original.objects.size, 0);
  assert.equal(next.objects.size, 0);
});

test('undo clears selection and invalidates rendering for a scene using a plain Set', async () => {
  const scene = new Level();
  scene.objects = new Set();
  Engine.currentScene = scene;
  const controller = makeController();
  const { handle } = await prepare(controller);
  await controller.command({ action: 'create', handle, object: rectangle });
  await controller.command({ action: 'finalise', handle });
  const [placed] = scene.objects;
  Engine.sortedObjects = [placed];
  Engine.zOrderDirty = false;

  await controller.command({ action: 'visibility', handle, visible: false });
  assert.equal(scene.objects.size, 0);
  assert.equal(Engine.selectedObject, null);
  assert.deepEqual(Engine.sortedObjects, []);
  assert.equal(Engine.zOrderDirty, true);

  Engine.zOrderDirty = false;
  await controller.command({ action: 'visibility', handle, visible: true });
  assert.equal([...scene.objects][0], placed);
  assert.equal(Engine.selectedObject, placed);
  assert.equal(Engine.zOrderDirty, true);
});

test('expires an unconfirmed placement and rejects stale finalisation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const scene = new Level();
  Engine.currentScene = scene;
  const controller = makeController();
  const { handle } = await prepare(controller);
  await controller.command({ action: 'create', handle, object: rectangle });
  t.mock.timers.tick(60_000);
  assert.equal(scene.objects.size, 0);
  await assert.rejects(controller.command({ action: 'finalise', handle }));
});

test('accepts project sprites with a raster signature and no MIME type', async t => {
  const originalImage = globalThis.Image;
  t.after(() => { globalThis.Image = originalImage; });
  globalThis.Image = class {
    complete = true;
    width = 1;
    height = 1;
    naturalWidth = 1;
    naturalHeight = 1;

    async decode() {
      const response = await fetch(this.src);
      assert.equal(response.headers.get('Content-Type'), 'image/png');
    }
  };
  const scene = new Level();
  Engine.currentScene = scene;
  const controller = makeController();
  const { handle } = await prepare(controller);
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
  const { id } = await controller.command({
    action: 'create', handle, object: { kind: 'Sprite', tag: 'Pixel', image: new Blob([bytes]), scale: 1 },
  });
  assert.equal([...scene.objects][0].id, id);
  await controller.command({ action: 'finalise', handle });
});
