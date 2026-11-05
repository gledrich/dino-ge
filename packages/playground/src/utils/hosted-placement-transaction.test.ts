import { describe, expect, jest, test } from '@jest/globals';
import type { HostedPlacementObject } from './hosted-placement';
import { commitHostedPlacement } from './hosted-placement-transaction';

const rectangle: HostedPlacementObject = {
  kind: 'Rectangle', tag: 'New rectangle', options: { width: 80, height: 48, colour: '#54d6ad' },
};

function setup() {
  const preview = {
    active: jest.fn(() => true),
    create: jest.fn(async () => ({ id: 'object' })),
    finalise: jest.fn<(handle: string) => Promise<void>>(async () => {}),
    cancel: jest.fn(),
  };
  const current = jest.fn(() => true);
  const apply = jest.fn(() => true);
  const commit = () => commitHostedPlacement(preview, 'handle', rectangle, current, apply);
  return { preview, current, apply, commit };
}

describe('hosted placement transaction', () => {
  test('applies the draft only after the preview creates the object', async () => {
    const { preview, apply, commit } = setup();
    let acknowledge!: (object: { id: string }) => void;
    preview.create.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    const operation = commit();
    expect(apply).not.toHaveBeenCalled();
    acknowledge({ id: 'object' });
    await operation;
    expect(apply).toHaveBeenCalledTimes(1);
    expect(preview.finalise).toHaveBeenCalledWith('handle');
    expect(preview.cancel).not.toHaveBeenCalled();
  });

  test('rolls back creation if the draft changes while waiting for the preview', async () => {
    const { preview, current, apply, commit } = setup();
    current.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await expect(commit()).rejects.toThrow('The script or preview changed during placement.');
    expect(preview.cancel).toHaveBeenCalledWith('handle');
    expect(preview.finalise).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  test('rolls back if the editor cannot apply the prepared edit', async () => {
    const { preview, apply, commit } = setup();
    apply.mockReturnValue(false);
    await expect(commit()).rejects.toThrow('Could not add the object to the draft.');
    expect(preview.cancel).toHaveBeenCalledWith('handle');
  });

  test('retries finalisation once and reports that the applied draft needs a rerun', async () => {
    const { preview, apply, commit } = setup();
    preview.finalise.mockRejectedValue(new Error('Timed out'));
    await expect(commit()).rejects.toThrow('Could not confirm the placement. Rerun the game to synchronise it with the draft.');
    expect(preview.finalise).toHaveBeenCalledTimes(2);
    expect(preview.cancel).toHaveBeenCalledWith('handle');
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
