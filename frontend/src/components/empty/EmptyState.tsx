import React from 'react';

interface Props {
  title: string;
  description?: string;
}

const EmptyState: React.FC<Props> = ({ title, description }) => {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <svg className="empty-illustration" viewBox="0 0 160 120" fill="none" aria-hidden>
        <path d="M10 96c30-18 50-18 80 0s50 18 60 8" stroke="currentColor" strokeWidth="4" opacity="0.18" />
        <path
          d="M48 82c0-18 12-36 32-36s32 18 32 36"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.4"
        />
        <path
          d="M34 88c0-22 16-48 46-48s46 26 46 48"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.28"
        />
        <path
          d="M80 34l10 18h-20l10-18Z"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.65"
        />
        <path
          d="M110 56l8 14h-16l8-14Z"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.6"
        />
        <rect x="70" y="52" width="20" height="12" rx="2" fill="currentColor" opacity="0.08" />
        <path d="M20 98h120" stroke="currentColor" strokeWidth="2" opacity="0.16" />
      </svg>
      <div>
        <h3>{title}</h3>
        {description && <p className="subtle">{description}</p>}
      </div>
    </div>
  );
};

export default EmptyState;
