import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';
import { Button } from './button';
import { ReadOnlyNote, SaveArea } from './read-only';

/* -------------------------------------------------------------------------- */
/* Dialog                                                                     */
/* -------------------------------------------------------------------------- */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  size = 'md',
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="data-[state=open]:animate-fade-in bg-overlay/40 fixed inset-0 z-50 backdrop-blur-[1px]" />
      <DialogPrimitive.Content
        className={cn(
          'data-[state=open]:animate-pop-in bg-surface fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl shadow-xl',
          width,
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <DialogPrimitive.Title className="text-base font-semibold text-slate-900">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-sm text-slate-500">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="-me-1 -mt-1 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 pointer-coarse:-me-2.5 pointer-coarse:-mt-2.5 pointer-coarse:p-2.5">
            <X className="size-5" />
            <span className="sr-only">{t('Close')}</span>
          </DialogPrimitive.Close>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('space-y-4 px-5 py-4', className)}>{children}</div>;
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        // Stays in view at the bottom of a long dialog.
        'sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 sm:flex-row sm:justify-end',
        className,
      )}
    >
      <SaveArea>{children}</SaveArea>
      <ReadOnlyNote className="sm:-order-1 sm:me-auto" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dropdown menu                                                              */
/* -------------------------------------------------------------------------- */

export const DropdownMenu = Menu.Root;
export const DropdownTrigger = Menu.Trigger;

export function DropdownContent({
  children,
  align = 'end',
  className,
}: {
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={6}
        className={cn(
          'data-[state=open]:animate-fade-in bg-surface z-50 min-w-48 rounded-lg border border-slate-200 p-1 shadow-lg',
          className,
        )}
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

export function DropdownItem({
  children,
  onSelect,
  danger,
  disabled,
  icon,
}: {
  children: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Menu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 pointer-coarse:min-h-11 [&_svg]:size-4',
        danger
          ? 'text-red-600 data-[highlighted]:bg-red-50'
          : 'text-slate-700 data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-900',
      )}
    >
      {icon ? <span className={danger ? 'text-red-500' : 'text-slate-500'}>{icon}</span> : null}
      {children}
    </Menu.Item>
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <Menu.Label className="px-2.5 py-1.5 text-xs font-medium text-slate-500">{children}</Menu.Label>
  );
}

export function DropdownSeparator() {
  return <Menu.Separator className="my-1 h-px bg-slate-100" />;
}

/* -------------------------------------------------------------------------- */
/* Confirmation dialog                                                        */
/* -------------------------------------------------------------------------- */

interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={options !== null} onOpenChange={(open) => !open && close(false)}>
        {options ? (
          <DialogContent title={options.title} size="sm">
            {options.description ? (
              <DialogBody>
                <div className="text-sm text-slate-600">{options.description}</div>
              </DialogBody>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>
                {options.cancelLabel ?? t('Cancel')}
              </Button>
              <Button
                variant={options.danger ? 'danger' : 'primary'}
                onClick={() => close(true)}
                autoFocus
              >
                {options.confirmLabel ?? t('Confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
}
