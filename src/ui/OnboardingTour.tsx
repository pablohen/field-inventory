import { Tour } from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isShown as defaultIsShown,
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
  isShown = defaultIsShown,
}: {
  storageKey: TourKey;
  steps: TourStepDef[];
  autoStart: boolean;
  /** Visibility check for step targets; injectable for tests. */
  isShown?: (el: Element) => boolean;
}) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState<TourStepDef[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Steps are picked one tick later, after anything else reacting to the same
  // request has re-rendered (the mobile drawer closes), so only targets that
  // are really on screen are used.
  const start = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const visible = visibleSteps(steps, isShown);
      if (visible.length === 0) return;
      setShown(visible);
      setStep(0);
      setActive(true);
    }, 0);
  }, [steps, isShown]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

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
