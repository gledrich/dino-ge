import React, { useRef, useState } from 'react';

interface ToolbarProps {
  isPaused: boolean;
  isDebug: boolean;
  isEditingScene: boolean;
  isEditingScreenUI: boolean;
  arePanelsMinimized: boolean;
  onTogglePause: () => void;
  onToggleDebug: () => void;
  onToggleSceneEditing?: () => void;
  onToggleScreenUIEditing?: () => void;
  onTogglePanels: () => void;
  onRefresh: () => void;
}

const Toolbar: React.FC<ToolbarProps> = ({
  isPaused,
  isDebug,
  isEditingScene,
  isEditingScreenUI,
  arePanelsMinimized,
  onTogglePause,
  onToggleDebug,
  onToggleSceneEditing,
  onToggleScreenUIEditing,
  onTogglePanels,
  onRefresh
}) => {
  const [showScreenUI, setShowScreenUI] = useState(false);
  const brush = useRef<HTMLButtonElement>(null);
  const screenButton = useRef<HTMLButtonElement>(null);
  const screenUIButton = onToggleScreenUIEditing && <button type="button" ref={screenButton} className="scene-edit-button"
    aria-label={isEditingScreenUI ? 'Finish editing Screen UI' : 'Edit Screen UI'} aria-pressed={isEditingScreenUI}
    title={isEditingScreenUI ? 'Finish editing Screen UI' : 'Edit Screen UI'} onClick={onToggleScreenUIEditing}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18m-12 4h6m-6 3h4" />
    </svg>
  </button>;
  return (
    <div className="toolbar">
      <button type="button"
        onClick={onTogglePause}
        aria-label={isPaused ? 'Play' : 'Pause'}
        title={isPaused ? 'Play' : 'Pause'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {isPaused ? <path d="m8 5 11 7-11 7z" /> : <path d="M9 5v14m6-14v14" />}
        </svg>
      </button>
      {onToggleSceneEditing ? <div className="toolbar-edit-group"
        onPointerEnter={event => { if (event.pointerType === 'mouse') setShowScreenUI(true); }}
        onPointerLeave={event => {
          if (event.pointerType === 'mouse' && !event.currentTarget.contains(document.activeElement)) setShowScreenUI(false);
        }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setShowScreenUI(false); }}
        onKeyDown={event => {
          if (event.key === 'ArrowUp' && onToggleScreenUIEditing && event.target === brush.current) {
            event.preventDefault();
            setShowScreenUI(true);
            requestAnimationFrame(() => screenButton.current?.focus({ preventScroll: true }));
            return;
          }
          if (event.key !== 'Escape' || !showScreenUI) return;
          event.stopPropagation();
          brush.current?.focus();
          setShowScreenUI(false);
        }}>
      <button type="button" ref={brush}
        className="scene-edit-button"
        onClick={onToggleSceneEditing}
        onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setShowScreenUI(true); }}
        aria-label="Edit scene"
        aria-keyshortcuts={onToggleScreenUIEditing ? 'ArrowUp' : undefined}
        aria-pressed={isEditingScene}
        title={isEditingScene ? 'Finish editing and resume the game' : 'Pause the game to drag and resize objects'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 11 17 4a2.8 2.8 0 0 1 4 4l-7 7-4-4Z" />
          <path d="M10 11c-3 0-4 2-4 4s-1 4-3 5c5 1 11-1 11-5" />
        </svg>
      </button>
      {screenUIButton && <>
        <button type="button" className="toolbar-edit-disclosure" aria-label="More editing tools"
          aria-expanded={showScreenUI} onClick={() => setShowScreenUI(open => !open)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 15 7-7 7 7" /></svg>
        </button>
        {showScreenUI && <div className="toolbar-edit-popover">{screenUIButton}</div>}
      </>}
      </div> : screenUIButton}
      <button type="button"
        onClick={onRefresh}
        aria-label="Reset game"
        title="Reset game (Ctrl+Enter)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 11a9 9 0 1 1 2 7M3 5v6h6" />
        </svg>
      </button>
      <button type="button"
        onClick={onToggleDebug}
        aria-label="Toggle debug mode"
        aria-pressed={isDebug}
        title="Toggle Debug Mode"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="7" y="7" width="10" height="13" rx="5" />
          <path d="m9 7-2-3m8 3 2-3M3 10l4 2m10 0 4-2M3 17l4-2m10 0 4 2M12 11v8" />
        </svg>
      </button>
      <button type="button"
        onClick={onTogglePanels}
        aria-label={arePanelsMinimized ? 'Restore panels' : 'Minimise all panels'}
        title={arePanelsMinimized ? 'Restore Panels' : 'Minimize All Panels'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={arePanelsMinimized
            ? 'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5'
            : 'M4 9h5V4m6 0v5h5M9 20v-5H4m16 0h-5v5'} />
        </svg>
      </button>
    </div>
  );
};

export default Toolbar;
