import React, { useEffect, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useRenderStore } from '../../store/renderStore';
import { openImageReduced } from '../../lib/open-image';
import { describeSize, reducedChoices } from '../../lib/reduced-open';
import { Button } from '../shared/Button';
import { Dialog } from '../shared/Dialog';
import { Select, type SelectOption } from '../shared/Select';
import { StatusMessage } from '../shared/StatusMessage';

/**
 * Shown when an image is too large to open at its own size (#69): it says
 * what failed and the image's size, and offers to open it at a smaller size
 * the user chooses, or to cancel. Nothing smaller is opened without that
 * choice. The image that was open stays open until one is.
 */
export const ReducedOpenDialog: React.FC = () => {
  const offer = useUIStore((s) => s.reducedOpenOffer);
  const setOffer = useUIStore((s) => s.setReducedOpenOffer);
  const [megapixels, setMegapixels] = useState<string>('');
  const [isOpening, setIsOpening] = useState(false);

  const choices = offer ? reducedChoices(offer) : [];
  const first = choices[0]?.megapixels;
  useEffect(() => {
    setMegapixels(first === undefined ? '' : String(first));
    setIsOpening(false);
  }, [offer, first]);

  if (!offer) return null;

  const close = () => setOffer(null);
  const chosen = choices.find((c) => String(c.megapixels) === megapixels) ?? choices[0];
  const options: SelectOption<string>[] = choices.map((c) => ({
    value: String(c.megapixels),
    label: `About ${c.megapixels} MP: ${c.size.widthPx} × ${c.size.heightPx} px`,
  }));

  const handleOpen = async () => {
    if (!chosen) return;
    setIsOpening(true);
    try {
      await openImageReduced(offer.file, chosen.size);
      close();
    } catch (err) {
      close();
      useRenderStore.getState().setErrorMessage(err instanceof Error ? err.message : 'Failed to load image file');
    }
  };

  return (
    <Dialog
      open
      onClose={close}
      icon={<Minimize2 size={16} />}
      title="This image is too large to open in full"
      footer={
        <>
          <Button compact onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" compact onClick={() => void handleOpen()} disabled={!chosen || isOpening}>
            {isOpening ? 'Opening…' : 'Open at Reduced Size'}
          </Button>
        </>
      }
    >
      <StatusMessage tone="warning">{offer.message}</StatusMessage>
      <p>
        “{offer.file.name}” is {describeSize(offer)}. You can open it smaller. Everything, exports included, is then
        made from the smaller image; the file itself is not changed.
      </p>
      {options.length > 0 ? (
        <Select label="Open at" value={chosen ? String(chosen.megapixels) : ''} options={options} onChange={setMegapixels} />
      ) : (
        <StatusMessage tone="error">This image is too small to reduce further.</StatusMessage>
      )}
    </Dialog>
  );
};
