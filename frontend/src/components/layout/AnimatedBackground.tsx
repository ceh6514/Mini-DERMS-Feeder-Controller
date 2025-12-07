import React from 'react';

interface Props {
  theme: 'day' | 'night';
}

const AnimatedBackground: React.FC<Props> = ({ theme }) => {
  return (
    <div className="animated-bg" aria-hidden>
      <div className="gradient" />
      <div className="sky-clouds" />
      <div className="sky-stars" />
      <div className="sky-orb" title={theme === 'day' ? 'Sun' : 'Moon'} />
    </div>
  );
};

export default AnimatedBackground;
