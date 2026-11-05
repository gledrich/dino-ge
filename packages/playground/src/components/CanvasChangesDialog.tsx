import { useEffect, useRef } from 'react';

interface CanvasChangesDialogProps {
  action: 'reset' | 'switch';
  onCancel: () => void;
  onConfirm: () => void;
}

export default function CanvasChangesDialog({ action, onCancel, onConfirm }: CanvasChangesDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    keepEditingRef.current?.focus();
    return () => dialog?.close();
  }, []);

  const keepEditing = () => {
    dialogRef.current?.close();
    onCancel();
  };

  return (
    <dialog ref={dialogRef} className="canvas-changes-dialog"
      aria-labelledby="canvas-changes-dialog-title" aria-describedby="canvas-changes-dialog-description"
      onCancel={event => {
        event.preventDefault();
        keepEditing();
      }}>
      <h2 id="canvas-changes-dialog-title">Discard pending canvas changes?</h2>
      <p id="canvas-changes-dialog-description">
        {action === 'reset' ? 'Resetting the game' : 'Switching scripts'} discards pending canvas changes.
        Keep editing if you want to apply them to the script first.
      </p>
      <div className="canvas-changes-dialog-actions">
        <button type="button" className="scene-control" ref={keepEditingRef} onClick={keepEditing}>Keep editing</button>
        <button type="button" className="scene-control canvas-changes-dialog-discard" onClick={() => {
          dialogRef.current?.close();
          onConfirm();
        }}>{action === 'reset' ? 'Reset and discard' : 'Switch and discard'}</button>
      </div>
    </dialog>
  );
}
