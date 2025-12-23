import React from 'react';
import LineIcon from '../icons/LineIcon';

interface DashboardSectionProps {
  sectionId: string;
  title: string;
  description: string;
  icon: string;
  sectionRef: React.RefObject<HTMLElement>;
  children: React.ReactNode;
}

const DashboardSection: React.FC<DashboardSectionProps> = ({
  sectionId,
  title,
  description,
  icon,
  sectionRef,
  children,
}) => {
  return (
    <section
      id={`${sectionId}-section`}
      ref={sectionRef as React.RefObject<HTMLDivElement>}
      className="section-block"
      data-section={sectionId}
      aria-labelledby={`${sectionId}-heading`}
    >
      <div className="section-head">
        <h2 id={`${sectionId}-heading`}>
          <LineIcon name={icon} size={20} /> {title}
        </h2>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
};

export default DashboardSection;
