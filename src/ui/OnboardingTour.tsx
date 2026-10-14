import { Tour } from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import {
  markTourSeen,
  onReplayRequest,
  type TourKey,
  type TourStepDef,
  takeReplayRequest,
  tourSeen,
  visibleSteps,
} from '#/ui/onboarding';

/**
 * A first-run tour. Starts once per device when `autoStart` is true and it
 * hasn't been seen; replays whenever `requestTourReplay(storageKey)` is called.
 * Closing or finishing marks it seen.
 */
export function OnboardingTour({
  storageKey,
  steps,
  autoStart,
}: {
  storageKey: TourKey;
  steps: TourStepDef[];
  autoStart: boolean;
}) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState<TourStepDef[]>([]);

  const start = useCallback(() => {
    const visible = visibleSteps(steps);
    if (visible.length === 0) return;
    setShown(visible);
    setStep(0);
    setActive(true);
  }, [steps]);

  // Storage is read after mount, so server rendering is unaffected.
  useEffect(() => {
    if (takeReplayRequest(storageKey)) start();
    else if (autoStart && !tourSeen(storageKey)) start();
  }, [autoStart, storageKey, start]);

  useEffect(
    () =>
      onReplayRequest(storageKey, () => {
        takeReplayRequest(storageKey);
        start();
      }),
    [storageKey, start],
  );

  const close = () => {
    setActive(false);
    markTourSeen(storageKey);
  };

  return (
    <Tour
      active={active}
      step={step}
      onStepChange={setStep}
      onClose={close}
      closeOnEscape
      withKeyboardNavigation
      className="fi-tour"
    >
      {shown.map((s) => (
        <Tour.Step
          key={s.id}
          target={s.target}
          title={s.title}
          position={s.position}
        >
          {s.body}
        </Tour.Step>
      ))}
    </Tour>
  );
}
