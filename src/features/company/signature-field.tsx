import { useEffect, useState } from 'react';
import { PenLine } from 'lucide-react';
import { toast } from 'sonner';
import type { Branding, SignatureInk } from '@/db/types';
import { imageInk, inkImage, normalizeImage } from '@/lib/image';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/misc';
import { ImageField } from './fields';
import { SignaturePad } from './signature-pad';

/** The upload kept with a blue signature, smaller: the company record also carries the logo. */
const ORIGINAL_SIZE = 600;

type SignaturePatch = Pick<Branding, 'signature' | 'signatureInk' | 'signatureOriginal'>;

/**
 * The printed signature: uploaded or drawn here, in its own colours or in
 * blue ink. The blue version is made once, here, and printed as it is; the
 * upload is kept beside it so the ink can be changed back.
 */
export function SignatureField({
  branding,
  onChange,
}: {
  branding: Branding;
  onChange: (patch: Partial<SignaturePatch>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  // A blue signature replaced by an older version of the app is in its own colours.
  const [replaced, setReplaced] = useState<string | null>(null);
  const signature = branding.signature ?? null;
  const chosen = branding.signatureInk ?? 'original';
  const stale = chosen === 'blue' && signature !== null && replaced === signature;
  const ink: SignatureInk = stale ? 'original' : chosen;
  // What the ink is applied to: the upload kept beside a blue signature.
  const source = ink === 'blue' ? branding.signatureOriginal || signature : signature;

  useEffect(() => {
    if (chosen !== 'blue' || !signature) return;
    let live = true;
    imageInk(signature)
      .then((found) => live && found === 'original' && setReplaced(signature))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [chosen, signature]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not use this image.'));
    } finally {
      setBusy(false);
    }
  };

  /** A new picture (uploaded or drawn), in the ink chosen. */
  const setPicture = async (upload: string | null) => {
    // Fields an older version never wrote stay unwritten unless the ink is changed.
    const kept = branding.signatureOriginal ? { signatureOriginal: null } : {};
    if (!upload) {
      onChange({ signature: null, ...kept });
    } else if (ink === 'blue') {
      onChange({
        signature: await inkImage(upload, 'blue'),
        signatureOriginal: await normalizeImage(upload, ORIGINAL_SIZE),
        signatureInk: 'blue',
      });
    } else {
      onChange({
        signature: upload,
        ...kept,
        ...(branding.signatureInk ? { signatureInk: 'original' as const } : {}),
      });
    }
  };

  const setInk = (next: SignatureInk) => {
    if (next === ink || busy) return;
    if (!signature || !source) {
      onChange({ signatureInk: next });
      return;
    }
    void run(async () => {
      if (next === 'blue') {
        onChange({
          signature: await inkImage(source, 'blue'),
          signatureOriginal: await normalizeImage(source, ORIGINAL_SIZE),
          signatureInk: 'blue',
        });
      } else {
        onChange({ signature: source, signatureOriginal: null, signatureInk: 'original' });
      }
    });
  };

  return (
    <div className="space-y-3">
      <ImageField
        label={t('Authorised signature')}
        uploadLabel={t('Upload signature')}
        description={t(
          'Sign on white paper and take a photo, draw it here, or use a transparent PNG. It is a printed signature, not an electronic one.',
        )}
        value={signature}
        onChange={setPicture}
        processing={busy}
        actions={
          <Button variant="outline" size="sm" onClick={() => setDrawing(true)} disabled={busy}>
            <PenLine /> {t('Draw signature')}
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span id="signature-ink" className="text-sm text-slate-700">
          {t('Ink')}
        </span>
        <div role="group" aria-labelledby="signature-ink">
          <Segmented
            size="sm"
            value={ink}
            onChange={setInk}
            options={[
              { value: 'original', label: t('Original') },
              { value: 'blue', label: t('Blue ink') },
            ]}
          />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        {t('Blue ink turns dark strokes blue and the paper transparent. The upload is kept.')}
      </p>
      <SignaturePad
        open={drawing}
        onOpenChange={setDrawing}
        onDone={(drawn) =>
          void run(async () => {
            await setPicture(await normalizeImage(drawn));
          })
        }
      />
    </div>
  );
}
