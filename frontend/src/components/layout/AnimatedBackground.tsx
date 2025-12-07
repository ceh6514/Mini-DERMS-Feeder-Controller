import React from 'react';
import StarField from './StarField';

interface Props {
  theme: 'day' | 'night';
}

const AnimatedBackground: React.FC<Props> = ({ theme }) => {
  return (
    <div className="animated-bg" aria-hidden>
      <div className="gradient" />
      <div className="sky-layer" />
      <StarField />
      <div className="sky-orb" title={theme === 'day' ? 'Sun' : 'Moon'} />
    </div>
  );
};

export default AnimatedBackground;
