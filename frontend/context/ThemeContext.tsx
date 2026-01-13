import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface ThemeContextType {
  isDarkMode: boolean;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  colors: {
    bg: string;
    bgSecondary: string;
    bgCard: string;
    text: string;
    textSecondary: string;
    accent: string;
    accentHover: string;
    border: string;
    borderAccent: string;
  };
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const theme: 'dark' | 'light' = isDarkMode ? 'dark' : 'light';

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDarkMode(false);
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    if (isDarkMode) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
  };

  const colors = isDarkMode
    ? {
        bg: '#070A12',
        bgSecondary: '#0d1117',
        bgCard: '#0f1419',
        text: '#ededed',
        textSecondary: 'rgba(237, 237, 237, 0.7)',
        accent: '#ffcc29',
        accentHover: '#e6b825',
        border: 'rgba(255, 255, 255, 0.08)',
        borderAccent: '#ffcc29',
      }
    : {
        bg: '#f5f5f5',
        bgSecondary: '#ffffff',
        bgCard: '#ffffff',
        text: '#070A12',
        textSecondary: 'rgba(7, 10, 18, 0.7)',
        accent: '#ffcc29',
        accentHover: '#e6b825',
        border: 'rgba(7, 10, 18, 0.1)',
        borderAccent: '#070A12',
      };

  return (
    <ThemeContext.Provider value={{ isDarkMode, theme, toggleTheme, colors }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Tailwind class helpers for common patterns
export const getThemeClasses = (isDarkMode: boolean) => ({
  // Backgrounds
  bg: isDarkMode ? 'bg-[#070A12]' : 'bg-[#ededed]',
  bgSecondary: isDarkMode ? 'bg-[#0d1117]' : 'bg-white',
  bgCard: isDarkMode ? 'bg-[#0f1419]' : 'bg-white',
  bgCardHover: isDarkMode ? 'hover:bg-[#161b22]' : 'hover:bg-gray-50',
  bgAccent: 'bg-[#ffcc29]',
  bgAccentLight: isDarkMode ? 'bg-[#ffcc29]/10' : 'bg-[#ffcc29]/30',
  
  // Text
  text: isDarkMode ? 'text-[#ededed]' : 'text-[#070A12]',
  textSecondary: isDarkMode ? 'text-slate-400' : 'text-[#070A12]/70',
  textMuted: isDarkMode ? 'text-slate-500' : 'text-[#070A12]/50',
  textAccent: 'text-[#ffcc29]',
  textOnAccent: 'text-[#070A12]',
  
  // Borders
  border: isDarkMode ? 'border-slate-700/50' : 'border-[#070A12]/20',
  borderAccent: 'border-[#ffcc29]',
  borderSecondary: isDarkMode ? 'border-slate-800' : 'border-[#070A12]/10',
  
  // Buttons
  btnPrimary: 'bg-[#ffcc29] text-[#070A12] hover:bg-[#e6b825]',
  btnSecondary: isDarkMode 
    ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' 
    : 'bg-[#070A12]/10 text-[#070A12] hover:bg-[#070A12]/20',
  btnOutline: isDarkMode
    ? 'border border-slate-600 text-slate-300 hover:bg-slate-800'
    : 'border border-[#070A12]/50 text-[#070A12] hover:bg-[#070A12]/10',
  
  // Input
  input: isDarkMode 
    ? 'bg-[#0d1117] border-slate-700 text-[#ededed] placeholder-slate-500 focus:border-[#ffcc29]'
    : 'bg-white border-[#070A12]/20 text-[#070A12] placeholder-[#070A12]/50 focus:border-[#ffcc29]',
  
  // Cards
  card: isDarkMode 
    ? 'bg-[#0f1419] border border-slate-700/50' 
    : 'bg-white border border-[#070A12]/10 shadow-sm',
  
  // Gradients
  gradientAccent: 'bg-gradient-to-r from-[#ffcc29] to-[#e6b825]',
  gradientBg: isDarkMode 
    ? 'bg-gradient-to-br from-[#070A12] via-[#0d1117] to-[#070A12]'
    : 'bg-gradient-to-br from-[#ededed] via-white to-[#ededed]',
});

export default ThemeContext;
