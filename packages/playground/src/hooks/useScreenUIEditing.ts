import { usePlayground } from '../context/PlaygroundContext';
import { browserPreviewUrl } from '../utils/helpers';
import { screenUIPreview } from '../utils/screen-ui-preview';

export function useScreenUIEditing() {
  const { isPaused, isDebug, setIsPaused, setIsDebug } = usePlayground();
  return {
    start() {
      const editingScene = !browserPreviewUrl && isPaused && isDebug;
      const previousFocus = document.activeElement;
      if (!screenUIPreview.beginEditing(isPaused && !editingScene)) return false;
      if (editingScene) setIsDebug(false);
      setIsPaused(true);
      requestAnimationFrame(() => {
        if (document.activeElement !== previousFocus && document.activeElement !== document.body) return;
        const handle = document.querySelector<HTMLButtonElement>('.screen-ui-drag-handle[aria-pressed="true"]') ??
          document.querySelector<HTMLButtonElement>('.screen-ui-drag-handle');
        handle?.focus({ preventScroll: true });
      });
      return true;
    },
    finish() {
      const { wasPaused } = screenUIPreview.getSnapshot();
      if (!screenUIPreview.finishEditing()) return false;
      setIsPaused(wasPaused);
      return true;
    },
  };
}
