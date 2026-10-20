import { useRef, useState, type PointerEvent } from 'react';
import { Eraser } from 'lucide-react';
import { inkBounds } from '@/lib/image';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';

/** Pen colour on the pad; the ink chosen for the signature is applied afterwards. */
const PEN = '#111827';

/**
 * Signing on the screen with a finger, a pen or the mouse. Gives the
 * signature as a PNG with a transparent background, cropped to what was
 * drawn, to be used like an uploaded picture of it.
 */
export function SignaturePad({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (dataUrl: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [drawn, setDrawn] = useState(false);

  /** The canvas, sized to its box at the screen's resolution the first time it is used. */
  const surface = () => {
    const el = canvas.current;
    const ctx = el?.getContext('2d', { willReadFrequently: true });
    if (!el || !ctx) return null;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(el.clientWidth * ratio);
    const height = Math.round(el.clientHeight * ratio);
    if (el.width !== width || el.height !== height) {
      el.width = width;
      el.height = height;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = PEN;
    ctx.fillStyle = PEN;
    ctx.lineWidth = 2.5 * ratio;
    return { el, ctx, ratio };
  };

  const point = (e: PointerEvent<HTMLCanvasElement>, ratio: number) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - box.left) * ratio, y: (e.clientY - box.top) * ratio };
  };

  const start = (e: PointerEvent<HTMLCanvasElement>) => {
    const s = surface();
    if (!s) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e, s.ratio);
    last.current = p;
    // A dot for a tap (the dot of an "i").
    s.ctx.beginPath();
    s.ctx.arc(p.x, p.y, s.ctx.lineWidth / 2, 0, Math.PI * 2);
    s.ctx.fill();
    setDrawn(true);
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const from = last.current;
    const s = from ? surface() : null;
    if (!from || !s) return;
    const p = point(e, s.ratio);
    s.ctx.beginPath();
    s.ctx.moveTo(from.x, from.y);
    s.ctx.lineTo(p.x, p.y);
    s.ctx.stroke();
    last.current = p;
  };

  const end = () => {
    last.current = null;
  };

  const clear = () => {
    const s = surface();
    s?.ctx.clearRect(0, 0, s.el.width, s.el.height);
    setDrawn(false);
  };

  const use = () => {
    const s = surface();
    if (!s) return;
    const { data } = s.ctx.getImageData(0, 0, s.el.width, s.el.height);
    const box = inkBounds(data, s.el.width, s.el.height, Math.round(8 * s.ratio));
    if (!box) return;
    const out = document.createElement('canvas');
    out.width = box.width;
    out.height = box.height;
    out
      .getContext('2d')
      ?.drawImage(s.el, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    onDone(out.toDataURL('image/png'));
    onOpenChange(false);
    setDrawn(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('Draw your signature')}
        description={t('Sign in the box with your finger, a pen or the mouse.')}
        size="lg"
      >
        <DialogBody>
          <canvas
            ref={canvas}
            aria-label={t('Signature pad')}
            className="h-48 w-full cursor-crosshair touch-none rounded-lg border-2 border-dashed border-slate-300 bg-white"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={clear} disabled={!drawn}>
            <Eraser /> {t('Clear')}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={use} disabled={!drawn}>
            {t('Use this signature')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
