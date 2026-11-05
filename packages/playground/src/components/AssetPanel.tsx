import React, { useEffect, useState } from 'react';
import { Loader } from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import { getSceneAssetPreviewType, sceneAssetDragType } from '../utils/scene-objects';
import '../styles/asset-panel.css';

interface AssetEntry {
  tag: string;
  image: HTMLImageElement;
}

const AssetPanel: React.FC = () => {
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const { isPaused, isDebug } = usePlayground();
  const isEditing = isPaused && isDebug;

  useEffect(() => {
    const updateAssets = () => setAssets(Loader.getLoadedAssets());

    updateAssets();
    // Poll for new assets
    const interval = setInterval(updateAssets, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="asset-panel">
      <p className="asset-help">{isEditing ? 'Drag an image onto the scene or click to add a sprite.' : 'Enter Edit scene to place images as sprites.'}</p>
      <div className="asset-list">
        {assets.length === 0 ? (
          <div className="no-assets">No assets loaded.</div>
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
