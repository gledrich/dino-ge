import React, { useEffect, useRef, useState } from 'react';
import { Engine, Loader } from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import { useScenePlacementSource } from '../hooks/useScenePlacementSource';
import { getSceneAssetPreviewType, insertSceneObjectCode, isReplaceableSprite, sceneAssetDragEvent, sceneAssetDragType, type SceneImageAsset } from '../utils/scene-objects';
import { browserPreviewUrl, getCurrentScriptId, getSpriteImageFileError, importSpriteImage, listSpriteImages, spriteImageTypes, type StoredSpriteImage } from '../utils/helpers';
import '../styles/asset-panel.css';

interface AssetEntry {
  tag: string;
  url: string;
  image?: HTMLImageElement;
  projectPath?: string;
}

function AssetTile({ asset, isEditing, canReplace, mobileDock, placementSource, onInsert }: {
  asset: AssetEntry;
  isEditing: boolean;
  canReplace: boolean;
  mobileDock: boolean;
  placementSource: ReturnType<typeof useScenePlacementSource>;
  onInsert: (asset: SceneImageAsset) => void;
}) {
  const [thumbnail, setThumbnail] = useState<HTMLImageElement>();
  const [unavailable, setUnavailable] = useState(false);
  const image = asset.image ?? thumbnail;
  const sceneAsset = image ? { tag: asset.tag, image, projectPath: asset.projectPath } : undefined;
  const canDragCode = !!browserPreviewUrl && !mobileDock && !!sceneAsset;
  const startDrag = (event: React.DragEvent<HTMLButtonElement>) => {
    if (!sceneAsset || placementSource.isActive()) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(sceneAssetDragType, asset.tag);
    event.dataTransfer.setData(getSceneAssetPreviewType(asset.tag), '');
    event.dataTransfer.effectAllowed = 'copy';
    window.dispatchEvent(new CustomEvent<SceneImageAsset>(sceneAssetDragEvent, { detail: sceneAsset }));
  };
  const endDrag = () => window.dispatchEvent(new CustomEvent(sceneAssetDragEvent, { detail: null }));
  return (
    <div className="asset-tile">
      <button type="button" className="scene-control asset-item" title={asset.url}
        aria-label={`Add ${asset.tag} as sprite`} disabled={!isEditing || !image} draggable={isEditing && !!image}
        {...placementSource.forItem(isEditing && sceneAsset ? { asset: sceneAsset } : undefined)}
        onClick={event => {
          if (placementSource.consumeClick(event)) return;
          if (sceneAsset) window.dispatchEvent(new CustomEvent<SceneImageAsset>('playground-place-asset', { detail: sceneAsset }));
        }}
        onDragStart={startDrag} onDragEnd={endDrag}
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
        {mobileDock && isEditing && image && <i className="fa-solid fa-grip-vertical" data-scene-drag-handle aria-hidden="true" />}
      </button>
      <div className="asset-actions">
        <button type="button" className="scene-control" disabled={!image} draggable={canDragCode}
          aria-label={`Insert ${asset.tag} sprite code`}
          title={`Insert sprite code for ${asset.tag}${canDragCode ? ' or drag it to the editor' : ''}`}
          onDragStart={canDragCode ? startDrag : undefined} onDragEnd={canDragCode ? endDrag : undefined}
          onClick={() => { if (sceneAsset) onInsert(sceneAsset); }}>
          Insert
        </button>
        {canReplace && (
          <button type="button" className="scene-control" disabled={!image}
            aria-label={`Replace selected sprite with ${asset.tag}`} title="Replace the selected sprite’s image"
            onClick={() => {
              if (sceneAsset) window.dispatchEvent(new CustomEvent<SceneImageAsset>('playground-replace-sprite-image', {
                detail: sceneAsset,
              }));
            }}>
            <i className="fa-solid fa-right-left" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

const AssetPanel: React.FC<{ mobileDock?: boolean }> = ({ mobileDock = false }) => {
  const [loadedImages, setLoadedImages] = useState<SceneImageAsset[]>([]);
  const [selected, setSelected] = useState(Engine.selectedObject);
  const [catalogue, setCatalogue] = useState<{ scriptId: string; images: StoredSpriteImage[]; error?: string }>();
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean }>();
  const [importingImage, setImportingImage] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);
  const { currentScriptId, isPaused, isDebug } = usePlayground();
  const isEditing = !browserPreviewUrl && isPaused && isDebug;
  const placementSource = useScenePlacementSource(isEditing);
  const canReplace = isEditing && isReplaceableSprite(selected);

  useEffect(() => {
    const updateAssets = () => setLoadedImages(Loader.getLoadedAssets());
    const clearAssets = () => {
      setLoadedImages([]);
      setFeedback(undefined);
    };
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
    let displayed: StoredSpriteImage[] = [];
    const release = (images: StoredSpriteImage[]) => images.forEach(image => image.release?.());
    const refresh = () => {
      pending?.abort();
      const request = new AbortController();
      pending = request;
      void listSpriteImages(currentScriptId, request.signal).then(images => {
        if (request.signal.aborted) {
          release(images);
          return;
        }
        release(displayed);
        displayed = images;
        setCatalogue({ scriptId: currentScriptId, images });
      }).catch(() => {
        if (request.signal.aborted) return;
        release(displayed);
        displayed = [];
        setCatalogue({ scriptId: currentScriptId, images: [], error: 'Could not load workspace images.' });
      });
    };
    const onStored = (event: Event) => {
      if ((event as CustomEvent<string>).detail === currentScriptId) refresh();
    };
    refresh();
    window.addEventListener('playground-workspace-images-changed', onStored);
    return () => {
      pending?.abort();
      release(displayed);
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
    assets.push({ tag, url, projectPath: image.projectPath });
  }

  const importImage = async (files: File[]) => {
    if (!browserPreviewUrl) {
      window.dispatchEvent(new CustomEvent('playground-import-image', { detail: files }));
      return;
    }
    const fileError = getSpriteImageFileError(files);
    if (fileError) {
      setFeedback({ message: fileError, error: true });
      return;
    }
    setImportingImage(true);
    setFeedback(undefined);
    const isCurrent = () => getCurrentScriptId() === currentScriptId;
    try {
      if (await importSpriteImage(files[0], currentScriptId, isCurrent)) {
        setFeedback({ message: 'Image imported. Use Insert to add sprite code.' });
      }
    } catch (error) {
      if (isCurrent()) {
        setFeedback({ message: error instanceof Error ? error.message : 'Could not import the image.', error: true });
      }
    } finally {
      setImportingImage(false);
    }
  };

  const insertSpriteCode = (asset: SceneImageAsset) => {
    const reject = (message: string) => setFeedback({ message, error: true });
    const placement = insertSceneObjectCode({ asset }, currentScriptId);
    if (!placement.sourceId) return reject(placement.error ?? 'Wait for the open script to start before inserting sprite code.');
    setFeedback({ message: `Inserted ${placement.tag}. Reset game to preview it.` });
  };

  return (
    <div className="asset-panel">
      <button type="button" className="scene-control" disabled={importingImage} onClick={() => filePicker.current?.click()}>
        <i className="fa-solid fa-upload" aria-hidden="true" /> {importingImage ? 'Importing…' : 'Import image'}
      </button>
      <input type="file" ref={filePicker} hidden accept={spriteImageTypes.join(',')} aria-label="Choose sprite image"
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (files.length) void importImage(files);
        }} />
      <p className="asset-help">{mobileDock ? 'Import an image to use it as a sprite.'
        : browserPreviewUrl ? 'Drop an image file onto the editor.' : 'Drop an image file onto the canvas or editor.'}</p>
      {assets.length > 0 && (
        <p className="asset-help">
          {browserPreviewUrl ? 'Use Insert to add sprite code.'
            : !isEditing ? 'Enter Edit scene to drag images. Use Insert to add sprite code.'
            : mobileDock ? 'Drag a grip to the canvas or tap an image to place it. Use Insert to add sprite code.'
              : 'Drag to the canvas to place, or to the editor for code. Click to place. Shift+Enter positions with keys.'}
        </p>
      )}
      {feedback && <p className={`library-feedback${feedback.error ? ' library-feedback-error' : ''}`}
        role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
      {workspace?.error && <p className="asset-help" role="status">{workspace.error}</p>}
      {canReplace && <p className="asset-help">Use the swap button to change the selected sprite’s image.</p>}
      <div className="asset-list">
        {assets.map(asset => <AssetTile key={`${asset.tag}:${asset.url}`} asset={asset} isEditing={isEditing} mobileDock={mobileDock}
          canReplace={canReplace} placementSource={placementSource} onInsert={insertSpriteCode} />)}
        {!assets.length && !workspace?.error && (
          <div className="no-assets">{workspace ? 'Imported images and images loaded by the game appear here.' : 'Loading workspace images…'}</div>
        )}
      </div>
    </div>
  );
};

export default AssetPanel;
