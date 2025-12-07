import React from 'react';

export type LineIconName =
  | 'power'
  | 'leaf'
  | 'cloud'
  | 'alert'
  | 'sun'
  | 'moon'
  | 'device'
  | 'spark';

interface Props {
  name: LineIconName;
  size?: number;
  strokeWidth?: number;
}

const paths: Record<LineIconName, JSX.Element> = {
  power: (
    <>
      <polyline points="12 2 12 12 7 17" />
      <polyline points="12 12 17 7" />
      <circle cx="12" cy="12" r="9.5" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c8.5 1.5 13.5-4.5 14-14C11 4 4 9 5 19Z" />
      <path d="M5 19c2-4 6.5-8 10-10" />
    </>
  ),
  cloud: (
    <>
      <path d="M5 16a4 4 0 0 1 0-8 6 6 0 0 1 11.7-1.2A4.5 4.5 0 1 1 17 16Z" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <line x1="12" y1="7" x2="12" y2="13" />
      <circle cx="12" cy="17" r="1" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5.5 5.5 4 4M19.5 19.5 18 18M18 6l1.5-1.5M6 18l-1.5 1.5" />
    </>
  ),
  moon: (
    <>
      <path d="M20 15a8 8 0 1 1-8-12 6 6 0 0 0 8 12Z" />
    </>
  ),
  device: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="3" ry="3" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h3" />
    </>
  ),
  spark: (
    <>
      <path d="M12 2 9 10h4l-3 8" />
      <path d="m15 14-3 8" />
    </>
  ),
};

const LineIcon: React.FC<Props> = ({ name, size = 20, strokeWidth = 1.5 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
};

export default LineIcon;
