export type MooniePose =
  | 'idle'
  | 'encouraging'
  | 'curious'
  | 'sleeping'
  | 'working'
  | 'break'
  | 'celebrating'
  | 'thinking';

export const mascotPoseNames: Record<MooniePose, string> = {
  idle: 'moonie-idle.png',
  encouraging: 'moonie-encouraging.png',
  curious: 'moonie-curious.png',
  sleeping: 'moonie-sleeping.png',
  working: 'moonie-working.png',
  break: 'moonie-break.png',
  celebrating: 'moonie-celebrating.png',
  thinking: 'moonie-thinking.png',
};
