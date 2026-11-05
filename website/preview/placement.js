import { Circle, Engine, Line, Rectangle, Sprite, Text, Vector2 } from "dino-ge";

const leaseMs = 15_000;
const maxHandles = 512;
const maxImageBytes = 5 * 1024 * 1024;
const sceneSourceKey = "__dinoPlaygroundSceneSource";

const dimension = value => Number.isFinite(value) && value > 0 && value <= 8192;
const colour = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const shapeOptions = {
  Rectangle: { width: dimension, height: dimension, colour },
  Circle: { radius: dimension, colour },
  Line: { length: dimension, strokeWidth: dimension },
  Text: {
    width: dimension, height: dimension, colour, backgroundColour: colour,
    text: value => typeof value === "string" && value.length <= 200,
    font: value => typeof value === "string" && /^[a-z0-9 -]{1,48}$/i.test(value),
    fontSize: value => typeof value === "string" && /^[1-9][0-9]{0,2}$/.test(value),
  },
};

export function readPlacementCanvas(canvas) {
  if (!canvas?.width || !canvas.height) return null;
  const { x, y, width, height } = canvas.getBoundingClientRect();
  return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
    ? { x, y, width, height } : null;
}

function readSceneSource(scene) {
  if (!scene) return;
  const source = Object.getOwnPropertyDescriptor(scene.constructor, sceneSourceKey)?.value;
  if (!source || typeof source.scriptId !== "string" || source.scriptId.length > 512 ||
      typeof source.className !== "string" || source.className.length > 256 || !source.className) {
    throw new Error("Canvas placement needs a named scene declared in the open script.");
  }
  return { scriptId: source.scriptId, className: source.className };
}

function assertCurrent(placement) {
  const scene = Engine.currentScene;
  if (placement.scene !== scene || placement.collection !== (scene?.objects ?? Engine.objects)) {
    throw new Error("The active scene changed before the object could be placed.");
  }
}

function setObjectPresence(scene, collection, object, present) {
  if (collection.has(object) === present) return;
  if (scene === Engine.currentScene && collection === (scene?.objects ?? Engine.objects)) {
    if (present) Engine.registerObject(object);
    else Engine.destroyObject(object);
  } else if (scene?.objects === collection) {
    if (present) scene.add(object);
    else scene.remove(object);
  } else if (present) {
    collection.add(object);
  } else {
    collection.delete(object);
  }
}

async function decodeSprite(blob) {
  if (!(blob instanceof Blob) || blob.size <= 0 || blob.size > maxImageBytes) {
    throw new Error("Sprite images can be up to 5 MiB.");
  }
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const signature = (...expected) => expected.every((value, index) => bytes[index] === value);
  const header = String.fromCharCode(...bytes);
  const types = [
    ["image/png", signature(137, 80, 78, 71, 13, 10, 26, 10)],
    ["image/jpeg", signature(255, 216, 255)],
    ["image/gif", /^GIF8[79]a/.test(header)],
    ["image/webp", header.startsWith("RIFF") && header.slice(8, 12) === "WEBP"],
  ];
  const type = types.find(([, matches]) => matches)?.[0];
  if (!type || (blob.type && blob.type !== "application/octet-stream" && blob.type !== type)) {
    throw new Error("Choose a PNG, JPEG, GIF or WebP sprite.");
  }

  const url = URL.createObjectURL(blob.slice(0, blob.size, type));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 64_000_000) {
      throw new Error("The sprite image dimensions are too large.");
    }
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function makeObject(placement, object, instantiate) {
  if (!object || typeof object.tag !== "string" || !object.tag.trim() || object.tag.length > 200) {
    throw new Error("Invalid object tag.");
  }
  const base = { tag: object.tag, position: new Vector2(placement.x, placement.y) };
  if (object.kind === "Sprite") {
    if (!Number.isFinite(object.scale) || object.scale <= 0 || object.scale > 8) {
      throw new Error("Invalid sprite scale.");
    }
    const img = await decodeSprite(object.image);
    return instantiate(() => {
      const sprite = new Sprite({ ...base, img, rows: 1, cols: 1, scale: object.scale });
      sprite.play();
      return sprite;
    });
  }
  if (typeof object.kind !== "string" || !Object.hasOwn(shapeOptions, object.kind)) {
    throw new Error("Choose a game object from the Library.");
  }
  const validators = shapeOptions[object.kind];
  const options = object.options;
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      Object.keys(options).length !== Object.keys(validators).length ||
      !Object.entries(validators).every(([key, validate]) => Object.hasOwn(options, key) && validate(options[key]))) {
    throw new Error("Invalid game object options.");
  }
  return instantiate(() => {
    switch (object.kind) {
      case "Rectangle": return new Rectangle({ ...base, ...options });
      case "Circle": return new Circle({ ...base, ...options });
      case "Text": return new Text({ ...base, ...options });
      case "Line": return new Line({
        ...base, p1: new Vector2(0, 0), p2: new Vector2(options.length, 0),
        width: options.strokeWidth, visible: true,
      });
    }
  });
}

export function createPlacementController(getCanvas, onChange) {
  const handles = new Map();

  function cancel(handle) {
    const placement = handles.get(handle);
    if (!placement || placement.finalised) return;
    handles.delete(handle);
    clearTimeout(placement.expiry);
    if (placement.object) {
      setObjectPresence(placement.scene, placement.collection, placement.object, false);
      onChange();
    }
  }

  function renew(handle, placement) {
    clearTimeout(placement.expiry);
    placement.expiry = setTimeout(() => cancel(handle), leaseMs);
  }

  function prepare(point) {
    const canvas = getCanvas();
    const { zoom, position } = Engine.camera;
    if (!readPlacementCanvas(canvas) || !Number.isFinite(zoom) || zoom <= 0) {
      throw new Error("Wait for the game canvas before placing an object.");
    }
    if (!point || ![point.x, point.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new Error("Place the object inside the game canvas.");
    }
    if (handles.size >= maxHandles) throw new Error("Save and rerun the game before placing more objects.");
    const x = Math.round(position.x + point.x * canvas.width / zoom);
    const y = Math.round(position.y + point.y * canvas.height / zoom);
    if (![x, y].every(Number.isSafeInteger)) throw new Error("The placement position is outside the supported range.");
    const scene = Engine.currentScene;
    const source = readSceneSource(scene);
    const handle = crypto.randomUUID();
    const placement = { x, y, scene, collection: scene?.objects ?? Engine.objects };
    handles.set(handle, placement);
    renew(handle, placement);
    return { handle, x, y, scene: source };
  }

  return {
    async command(data) {
      if (data.action === "prepare") return prepare(data.point);
      const { handle } = data;
      if (typeof handle !== "string" || handle.length !== 36) throw new Error("Invalid placement handle.");
      if (data.action === "cancel") {
        cancel(handle);
        return {};
      }
      const placement = handles.get(handle);
      if (!placement) throw new Error("This placement expired.");
      if (data.action === "create") {
        const assertAvailable = () => {
          if (handles.get(handle) !== placement) throw new Error("This placement expired.");
          assertCurrent(placement);
        };
        const assertAccepted = () => {
          assertAvailable();
          if (!placement.collection.has(placement.object)) throw new Error("The scene did not accept this object.");
        };
        const instantiate = build => {
          assertAvailable();
          const collections = new Map();
          const captureCollection = () => {
            const scene = Engine.currentScene;
            collections.set(scene?.objects ?? Engine.objects, scene);
          };
          // Constructors register with whichever scene is active after creation callbacks.
          captureCollection();
          Engine.on("sceneHierarchyChanged", captureCollection);
          try {
            const object = build();
            placement.object = object;
            assertAccepted();
            Engine.selectedObject = object;
            // Selection listeners can synchronously switch scenes or remove the object.
            assertAccepted();
            return { id: object.id };
          } catch (error) {
            if (placement.object) {
              captureCollection();
              for (const [collection, scene] of [...collections]) {
                setObjectPresence(scene, collection, placement.object, false);
              }
            }
            throw error;
          } finally {
            Engine.off("sceneHierarchyChanged", captureCollection);
          }
        };
        placement.creation ??= makeObject(placement, data.object, instantiate).then(result => {
          assertAccepted();
          renew(handle, placement);
          onChange();
          return result;
        }).catch(error => {
          cancel(handle);
          throw error;
        });
        return placement.creation;
      }
      if (!placement.object) throw new Error("The preview has not created this placement.");
      if (data.action === "finalise") {
        placement.finalised = true;
        clearTimeout(placement.expiry);
      } else if (data.action === "visibility" && typeof data.visible === "boolean") {
        setObjectPresence(placement.scene, placement.collection, placement.object, data.visible);
        if (data.visible && placement.scene === Engine.currentScene &&
            placement.collection === (placement.scene?.objects ?? Engine.objects) && placement.collection.has(placement.object)) {
          Engine.selectedObject = placement.object;
        }
        onChange();
      } else {
        throw new Error("Unknown placement action.");
      }
      return {};
    },
  };
}
