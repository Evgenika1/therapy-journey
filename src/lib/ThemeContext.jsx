'use client';
import { createContext, useContext, useState, useEffect } from 'react';

const LIGHT = {
  BG:        '#F7F5F2',
  SURFACE:   '#FFFFFF',
  WHITE:     '#FFFFFF',
  BORDER:    '#E8E2DA',
  H1:        '#1A1208',
  BODY:      '#2C1A0E',
  MUTED:     '#8A7A6A',
  SEC:       '#8A7A6A',
  CORAL:     '#E8673A',
  NAV_ACTIVE:'#FDF0EA',
  GREEN:     '#15803D',
  ERR:       '#DC2626',
  isDark:    false,
};

const DARK = {
  BG:        '#0F0F0F',
  SURFACE:   '#1A1A1A',
  WHITE:     '#1A1A1A',
  BORDER:    '#2A2A2A',
  H1:        '#F5F0EA',
  BODY:      '#D0C8BE',
  MUTED:     '#706860',
  SEC:       '#706860',
  CORAL:     '#E8673A',
  NAV_ACTIVE:'#1F1612',
  GREEN:     '#22C55E',
  ERR:       '#F87171',
  isDark:    true,
};

const ThemeCtx = createContext(LIGHT);

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('tj_theme');
    if (saved === 'dark') setDark(true);
  }, []);

  function toggle() {
    setDark(d => {
      const next = !d;
      localStorage.setItem('tj_theme', next ? 'dark' : 'light');
      return next;
    });
  }

  return (
    <ThemeCtx.Provider value={{ ...(dark ? DARK : LIGHT), toggleTheme: toggle }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeCtx);
}
