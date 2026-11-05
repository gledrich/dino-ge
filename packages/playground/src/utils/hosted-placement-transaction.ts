import type { HostedPlacementConnection, HostedPlacementObject } from './hosted-placement';

export async function commitHostedPlacement(
  preview: Pick<HostedPlacementConnection, 'active' | 'create' | 'finalise' | 'cancel'>,
  handle: string,
  object: HostedPlacementObject,
  current: () => boolean,
  applyDraft: () => boolean,
) {
  let draftApplied = false;
  let finalised = false;
  const checkCurrent = () => {
    if (!current()) throw new Error('The script or preview changed during placement.');
  };
  try {
    checkCurrent();
    await preview.create(handle, object);
    checkCurrent();
    if (!applyDraft()) throw new Error('Could not add the object to the draft.');
    draftApplied = true;
    try {
      await preview.finalise(handle);
    } catch (error) {
      if (!preview.active()) throw error;
      await preview.finalise(handle);
    }
    finalised = true;
  } catch (error) {
    if (draftApplied) throw new Error('Could not confirm the placement. Rerun the game to synchronise it with the draft.');
    throw error;
  } finally {
    if (!finalised) preview.cancel(handle);
  }
}
