import { useEffect, useMemo, useState } from 'react';

export type UiTheme = 'day' | 'night';

export function useDayNightTheme(): UiTheme {
  const [theme, setTheme] = useState<UiTheme>('day');

  const computeTheme = useMemo(() => {
    const now = new Date();
    const hour = now.getHours();
    return hour >= 7 && hour < 19 ? 'day' : 'night';
  }, []);

  useEffect(() => {
    setTheme(computeTheme);
  }, [computeTheme]);

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  return theme;
}
