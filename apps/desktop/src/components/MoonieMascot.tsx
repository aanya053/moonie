import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import idle from '../assets/mascot/moonie-idle.png';
import encouraging from '../assets/mascot/moonie-encouraging.png';
import curious from '../assets/mascot/moonie-curious.png';
import sleeping from '../assets/mascot/moonie-sleeping.png';
import working from '../assets/mascot/moonie-working.png';
import breakPose from '../assets/mascot/moonie-break.png';
import celebrating from '../assets/mascot/moonie-celebrating.png';
import thinking from '../assets/mascot/moonie-thinking.png';
import { type MooniePose } from './mascotPoses';
import { isPrimaryPointerClick } from '../lib/interaction';

const mascotPoseAssets: Record<MooniePose, string> = {
  idle, encouraging, curious, sleeping, working, break: breakPose, celebrating, thinking,
};

export interface MoonieMascotProps {
  isExpanded: boolean;
  onToggle: () => void;
  pose?: MooniePose;
  size?: number;
  decorative?: boolean;
}

export const MoonieMascot: React.FC<MoonieMascotProps> = ({
  isExpanded,
  onToggle,
  pose = 'idle',
  size = 56,
  decorative = false,
}) => {
  const [imageSource, setImageSource] = useState(mascotPoseAssets[pose]);
  const [hasFailed, setHasFailed] = useState(false);
  const label = pose === 'idle' ? 'Moonie' : `Moonie ${pose}`;

  return (
    <motion.button
      type="button"
      onClick={(event) => { if (isPrimaryPointerClick(event)) onToggle(); }}
      className="mascot-button relative flex items-center justify-center cursor-pointer select-none focus:outline-none"
      style={{ width: size, height: size }}
      aria-label={isExpanded ? 'Collapse Moonie' : 'Talk to Moonie'}
      title={isExpanded ? 'Click to minimize Moonie' : 'Click to talk with Moonie'}
      aria-hidden={decorative}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.97 }}
    >
      <motion.span
        className="mascot-halo absolute inset-0 rounded-full pointer-events-none"
        animate={{ scale: [1, 1.06, 1], opacity: [0.45, 0.7, 0.45] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.span
        className="mascot-image-wrap relative z-10 flex items-center justify-center drop-shadow-md"
        animate={{ y: [0, -2, 0] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {hasFailed ? (
            <span className="mascot-fallback" aria-label={label}>☾</span>
          ) : (
            <motion.img
              key={imageSource}
              src={imageSource}
              alt={decorative ? '' : label}
              className="mascot-image"
              draggable={false}
              onError={() => {
                if (imageSource !== mascotPoseAssets.idle) setImageSource(mascotPoseAssets.idle);
                else setHasFailed(true);
              }}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.18 }}
            />
          )}
        </AnimatePresence>
      </motion.span>
    </motion.button>
  );
};
