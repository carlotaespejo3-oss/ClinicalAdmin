// Tracks how long the clinician actively spends on one email using the
// Page Visibility API. "Active" means the browser tab is in the foreground;
// time is paused when the tab is hidden (e.g. clinician switches to another
// window or locks the screen).
//
// On email close (emailId changes or becomes null) the accumulated time is
// compared to the estimate:
//   • ≤ 2× estMin  →  record silently (auto-learn)
//   • > 2× estMin  →  raise a pending sample so TimingPrompt can ask
//
// A minimum of 30 s must have elapsed for the sample to count at all.

import { useEffect, useRef } from 'react';
import type { AiCategory } from '@/lib/types';
import { recordSample, setPendingSample } from '@/lib/timeTrackingStore';

const AUTO_RECORD_RATIO = 2.0;

export function useEmailTimer(
  emailId: number | null,
  estMin: number,
  category: AiCategory | null,
) {
  // Refs survive re-renders without triggering them.
  const startRef = useRef<number>(0);
  const accumulatedMsRef = useRef<number>(0);
  const isVisibleRef = useRef<boolean>(true);

  useEffect(() => {
    if (emailId === null || !category || estMin <= 0) return;

    // Initialise for this email.
    accumulatedMsRef.current = 0;
    isVisibleRef.current = !document.hidden;
    startRef.current = Date.now();

    const handleVisibility = () => {
      if (document.hidden) {
        if (isVisibleRef.current) {
          accumulatedMsRef.current += Date.now() - startRef.current;
          isVisibleRef.current = false;
        }
      } else {
        startRef.current = Date.now();
        isVisibleRef.current = true;
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);

      // Flush any remaining visible time.
      let totalMs = accumulatedMsRef.current;
      if (isVisibleRef.current) totalMs += Date.now() - startRef.current;

      const activeMin = totalMs / 60_000;

      // Ignore drive-by opens.
      if (activeMin < 0.5) return;

      if (activeMin <= estMin * AUTO_RECORD_RATIO) {
        recordSample(category, activeMin, estMin);
      } else {
        setPendingSample({ category, activeMin, estMin });
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailId]); // intentionally only re-runs on email change; estMin/category are stable per email
}
