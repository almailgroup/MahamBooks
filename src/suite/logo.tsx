import { suiteName } from '@/lib/brand';
import { cn } from '@/lib/cn';

/**
 * The Maham One logo (scripts/make-icons.mjs cuts it out of the official
 * artwork in brand/). Files in public/brand keep their names, so emails can
 * link to them too.
 */

const BASE = import.meta.env.BASE_URL;
export const LOGO_URL = `${BASE}brand/maham-one-logo.png`;
export const LOGO_DARK_URL = `${BASE}brand/maham-one-logo-dark.png`;
export const MARK_URL = `${BASE}brand/maham-one-mark.png`;

/** Width of the logo for each pixel of height. */
export const LOGO_RATIO = 955 / 192;

/**
 * The logo, mark and name, with a white "Maham" on dark themes. Its height
 * sets its size (`h-8`); the width follows.
 */
export function SuiteLogo({ className }: { className?: string }) {
  return (
    <span role="img" aria-label={suiteName()} className={cn('inline-flex shrink-0', className)}>
      <img src={LOGO_URL} alt="" draggable={false} className="h-full w-auto dark:hidden" />
      <img
        src={LOGO_DARK_URL}
        alt=""
        draggable={false}
        className="hidden h-full w-auto dark:block"
      />
    </span>
  );
}

/** The mark alone, where the name doesn't fit (the phone's top bar). */
export function SuiteMark({ className }: { className?: string }) {
  return (
    <img
      src={MARK_URL}
      alt={suiteName()}
      draggable={false}
      className={cn('shrink-0 object-contain', className)}
    />
  );
}
