import React, { useEffect, useRef, useState } from 'react';
import { Engine, Loader } from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import { useScenePointerDrag } from '../hooks/useScenePointerDrag';
import { getSceneAssetPreviewType, isReplaceableSprite, sceneAssetDragType, type SceneImageAsset } from '../utils/scene-objects';
import { listSpriteImages, spriteImageTypes, type StoredSpriteImage } from '../utils/helpers';
import '../styles/asset-panel.css';

interface AssetEntry {
  tag: string;
  url: string;
  image?: HTMLImageElement;
}

function AssetTile({ asset, isEditing, canReplace, pointerDrag }: {
  asset: AssetEntry;
  isEditing: boolean;
  canReplace: boolean;
  pointerDrag: ReturnType<typeof useScenePointerDrag>;
}) {
  const [thumbnail, setThumbnail] = useState<HTMLImageElement>();
  const [unavailable, setUnavailable] = useState(false);
  const image = asset.image ?? thumbnail;
  return (
    <div className="asset-tile">
      <button type="button" className="scene-control asset-item" title={asset.url}
        aria-label={`Add ${asset.tag} as sprite`} disabled={!isEditing || !image} draggable={isEditing && !!image}
        {...pointerDrag.forItem(isEditing && image ? { asset: { tag: asset.tag, image } } : undefined)}
        onClick={event => {
          if (pointerDrag.consumeClick(event)) return;
          if (image) window.dispatchEvent(new CustomEvent<SceneImageAsset>('playground-place-asset', { detail: { tag: asset.tag, image } }));
        }}
        onDragStart={event => {
          if (pointerDrag.isActive()) {
            event.preventDefault();
            return;
          }
          if (!image) return;
          event.dataTransfer.setData(sceneAssetDragType, asset.tag);
          event.dataTransfer.setData(getSceneAssetPreviewType(asset.tag), '');
          event.dataTransfer.effectAllowed = 'copy';
          window.dispatchEvent(new CustomEvent<SceneImageAsset>('playground-drag-scene-asset', { detail: { tag: asset.tag, image } }));
        }}
        onDragEnd={() => window.dispatchEvent(new CustomEvent('playground-drag-scene-asset', { detail: null }))}
      >
        <div className="asset-preview">
          {!unavailable && <img src={asset.url} alt="" draggable={false} loading="lazy"
            onLoad={event => {
              if (asset.image) return;
              // Keep the sprite image detached so its dimensions are independent of the thumbnail CSS.
              const original = new Image();
              original.src = event.currentTarget.src;
              void original.decode().then(() => setThumbnail(original)).catch(() => setUnavailable(true));
            }}
            onError={() => setUnavailable(true)} />}
        </div>
        <div className="asset-info">
          <span className="asset-tag">{asset.tag}</span>
          <span className="asset-details">
            {image ? `${image.naturalWidth} × ${image.naturalHeight} px` : unavailable ? 'Image unavailable' : 'Loading image…'}
          </span>
        </div>
      </button>
      {canReplace && (
        <button type="button" className="scene-control asset-replace" disabled={!image}
          aria-label={`Replace selected sprite with ${asset.tag}`} title="Replace the selected sprite’s image"
          onClick={() => {
            if (image) window.dispatchEvent(new CustomEvent<SceneImageAsset>('playground-replace-sprite-image', {
              detail: { tag: asset.tag, image },
            }));
          }}>
          <i className="fa-solid fa-right-left" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

const AssetPanel: React.FC = () => {
  const [loadedImages, setLoadedImages] = useState<SceneImageAsset[]>([]);
  const [selected, setSelected] = useState(Engine.selectedObject);
  const [catalogue, setCatalogue] = useState<{ scriptId: string; images: StoredSpriteImage[]; error?: string }>();
  const filePicker = useRef<HTMLInputElement>(null);
  const { currentScriptId, isPaused, isDebug } = usePlayground();
  const isEditing = isPaused && isDebug;
  const pointerDrag = useScenePointerDrag(isEditing);
  const canReplace = isEditing && isReplaceableSprite(selected);

  useEffect(() => {
    const updateAssets = () => setLoadedImages(Loader.getLoadedAssets());
    const clearAssets = () => setLoadedImages([]);
    const updateSelection = () => setSelected(Engine.selectedObject);
    updateAssets();
    Engine.on('selectedObjectChanged', updateSelection);
    const interval = setInterval(updateAssets, 1000);
    window.addEventListener('playground-before-run', clearAssets);
    return () => {
      clearInterval(interval);
      Engine.off('selectedObjectChanged', updateSelection);
      window.removeEventListener('playground-before-run', clearAssets);
    };
  }, []);

  useEffect(() => {
    let pending: AbortController | undefined;
    const refresh = () => {
      pending?.abort();
      const request = new AbortController();
      pending = request;
      void listSpriteImages(currentScriptId, request.signal).then(images => {
        if (!request.signal.aborted) setCatalogue({ scriptId: currentScriptId, images });
      }).catch(() => {
        if (!request.signal.aborted) setCatalogue({ scriptId: currentScriptId, images: [], error: 'Could not load workspace images.' });
      });
    };
    const onStored = (event: Event) => {
      if ((event as CustomEvent<string>).detail === currentScriptId) refresh();
    };
    refresh();
    window.addEventListener('playground-workspace-images-changed', onStored);
    return () => {
      pending?.abort();
      window.removeEventListener('playground-workspace-images-changed', onStored);
    };
  }, [currentScriptId]);

  const workspace = catalogue?.scriptId === currentScriptId ? catalogue : undefined;
  const assets: AssetEntry[] = loadedImages.map(asset => ({ ...asset, url: asset.image.src }));
  const sources = new Set(assets.map(asset => asset.url));
  const tags = new Set(assets.map(asset => asset.tag));
  for (const image of workspace?.images ?? []) {
    const url = new URL(image.url, location.href).href;
    if (sources.has(url)) continue;
    let tag = image.name;
    for (let i = 2; tags.has(tag); i++) tag = `${image.name} ${i}`;
    sources.add(url);
    tags.add(tag);
    assets.push({ tag, url });
  }

  return (
    <div className="asset-panel">
      <button type="button" className="scene-control" onClick={() => filePicker.current?.click()}>
        <i className="fa-solid fa-upload" aria-hidden="true" /> Import image
      </button>
      <input type="file" ref={filePicker} hidden accept={spriteImageTypes.join(',')} aria-label="Choose sprite image"
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (files.length) window.dispatchEvent(new CustomEvent('playground-import-image', { detail: files }));
        }} />
      <p className="asset-help">Import an image or drop it onto the canvas to place a sprite.</p>
      {assets.length > 0 && (
        <p className="asset-help">
          {isEditing ? 'Drag a listed image onto the scene or click to place it.' : 'Enter Edit scene to place listed images.'}
        </p>
      )}
      {workspace?.error && <p className="asset-help" role="status">{workspace.error}</p>}
      {canReplace && <p className="asset-help">Use the swap button to change the selected sprite’s image.</p>}
      <div className="asset-list">
        {assets.map(asset => <AssetTile key={`${asset.tag}:${asset.url}`} asset={asset} isEditing={isEditing}
          canReplace={canReplace} pointerDrag={pointerDrag} />)}
        {!assets.length && !workspace?.error && (
          <div className="no-assets">{workspace ? 'Imported images and images loaded by the game appear here.' : 'Loading workspace images…'}</div>
        )}
      </div>
    </div>
  );
};

export default AssetPanel;
