import { Languages } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useLanguage } from './provider';

/** Switches the interface between English and Arabic. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { language, setLanguage } = useLanguage();
  const next = language === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      onClick={() => void setLanguage(next)}
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
