import test from 'node:test';
import assert from 'node:assert/strict';
import { mascotPoseNames } from '../components/mascotPoses.ts';

test('maps every supported Moonie pose to a local asset', () => {
  const poses = ['idle', 'encouraging', 'curious', 'sleeping', 'working', 'break', 'celebrating', 'thinking'] as const;
  assert.deepEqual(Object.keys(mascotPoseNames).sort(), [...poses].sort());
  for (const pose of poses) assert.match(mascotPoseNames[pose], /moonie-[a-z]+\.png$/);
});
