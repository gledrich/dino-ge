import React, { useEffect, useRef, useState } from 'react';
import { Engine } from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import { getSceneAssetPreviewType, getSceneAssets, sceneAssetDragType } from '../utils/scene-objects';
import { spriteImageTypes } from '../utils/helpers';
import '../styles/asset-panel.css';

interface AssetEntry {
  tag: string;
  image: HTMLImageElement;
}

const AssetPanel: React.FC = () => {
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const filePicker = useRef<HTMLInputElement>(null);
  const { isPaused, isDebug } = usePlayground();
  const isEditing = isPaused && isDebug;

  useEffect(() => {
    const updateAssets = () => setAssets(getSceneAssets());

    updateAssets();
    Engine.on('sceneHierarchyChanged', updateAssets);
    // Images in a saved script can finish decoding after the scene changes.
    const interval = setInterval(updateAssets, 1000);
    return () => {
      clearInterval(interval);
      Engine.off('sceneHierarchyChanged', updateAssets);
    };
  }, []);

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
      <div className="asset-list">
        {assets.length === 0 ? (
          <div className="no-assets">Imported images and images loaded by the game appear here.</div>
        ) : (
          assets.map((asset) => (
            <button key={asset.tag} type="button" className="scene-control asset-item" title={asset.image.src}
              aria-label={`Add ${asset.tag} as sprite`} disabled={!isEditing} draggable={isEditing}
              onClick={() => window.dispatchEvent(new CustomEvent('playground-place-asset', { detail: asset.tag }))}
              onDragStart={event => {
                event.dataTransfer.setData(sceneAssetDragType, asset.tag);
                event.dataTransfer.setData(getSceneAssetPreviewType(asset.tag), '');
                event.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <div className="asset-preview">
                <img src={asset.image.src} alt="" draggable={false} />
              </div>
              <div className="asset-info">
                <span className="asset-tag">{asset.tag}</span>
                <span className="asset-details">
                  {asset.image.width}x{asset.image.height}px
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default AssetPanel;
