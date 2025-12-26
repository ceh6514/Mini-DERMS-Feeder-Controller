import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';

const defaultSections = ['hero', 'generation', 'consumption', 'grid', 'forecast', 'devices', 'settings'] as const;
export type DashboardSectionKey = (typeof defaultSections)[number];
export type SectionRefMap = Record<DashboardSectionKey, RefObject<HTMLDivElement | null>>;

export const useDashboardSections = (sections: DashboardSectionKey[] = defaultSections) => {
  const [activeSection, setActiveSection] = useState<DashboardSectionKey>(sections[0]);
  const activeSectionRef = useRef<DashboardSectionKey>(sections[0]);

  const heroRef = useRef<HTMLDivElement | null>(null);
  const generationRef = useRef<HTMLDivElement | null>(null);
  const consumptionRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const forecastRef = useRef<HTMLDivElement | null>(null);
  const devicesRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  const sectionRefs: SectionRefMap = useMemo(
    () => ({
      hero: heroRef,
      generation: generationRef,
      consumption: consumptionRef,
      grid: gridRef,
      forecast: forecastRef,
      devices: devicesRef,
      settings: settingsRef,
    }),
    [],
  );

  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => {
            const aIndex = sections.indexOf((a.target as HTMLElement).dataset.section as DashboardSectionKey);
            const bIndex = sections.indexOf((b.target as HTMLElement).dataset.section as DashboardSectionKey);
            return aIndex - bIndex;
          });

        const nextSection = visible[0]?.target.getAttribute('data-section') as DashboardSectionKey | undefined;
        if (nextSection && nextSection !== activeSectionRef.current) {
          activeSectionRef.current = nextSection;
          setActiveSection(nextSection);
        }
      },
      {
        threshold: 0.35,
      },
    );

    const elements = Object.values(sectionRefs)
      .map((ref) => ref.current)
      .filter((el): el is HTMLElement => Boolean(el));

    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [sectionRefs, sections]);

  const handleNav = useCallback(
    (key: DashboardSectionKey | string) => {
      const sectionKey = sections.includes(key as DashboardSectionKey)
        ? (key as DashboardSectionKey)
        : sections[0];

      setActiveSection(sectionKey);
      const ref = sectionRefs[sectionKey];
      if (ref?.current) {
        ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [sectionRefs, sections],
  );

  return {
    activeSection,
    sectionRefs,
    handleNav,
  };
};
