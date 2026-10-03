import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DirectionProvider } from '@radix-ui/react-direction';
import { currentLanguage, direction, loadLanguage, t, type Language } from './index';

interface LanguageContextValue {
  language: Language;
  dir: 'ltr' | 'rtl';
  setLanguage: (language: Language) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  dir: 'ltr',
  setLanguage: async () => {},
});

/**
 * Holds the interface language. Changing it reloads the dictionary and
 * remounts the app, so every `t()` call renders in the new language.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setState] = useState<Language>(currentLanguage);
  const setLanguage = useCallback(async (next: Language) => {
    await loadLanguage(next, true);
    setState(next);
  }, []);
  const dir = direction(language);
  const value = useMemo(() => ({ language, dir, setLanguage }), [language, dir, setLanguage]);
  return (
    <LanguageContext.Provider value={value}>
      <DirectionProvider dir={dir}>
        <Fragment key={language}>{children}</Fragment>
      </DirectionProvider>
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

/**
 * Translates text with placeholders filled by elements:
 * `tr('Signed in as {name}', { name: <strong>{user}</strong> })`.
 */
export function tr(text: string, vars: Record<string, ReactNode>): ReactNode {
  const translated = t(text);
  const parts = translated.split(/(\{\w+\})/g);
  return parts.map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    if (name && name in vars) return <Fragment key={i}>{vars[name]}</Fragment>;
    return part ? <Fragment key={i}>{part}</Fragment> : null;
  });
}
