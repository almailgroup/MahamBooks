import { Languages } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSwitchLanguage } from '@/hooks/use-switch-language';
import { useLanguage } from './provider';

/** Switches the interface between English and Arabic (asking first if a form has unsaved changes). */
export function LanguageSwitch({ className }: { className?: string }) {
  const { language } = useLanguage();
  const switchLanguage = useSwitchLanguage();
  const next = language === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      onClick={() => void switchLanguage(next)}
      lang={next}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        className,
      )}
    >
      <Languages className="size-4" aria-hidden />
      {next === 'ar' ? 'العربية' : 'English'}
    </button>
  );
}
