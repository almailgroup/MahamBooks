import { useCallback, useState } from 'react';
import type { ID } from '@/db/types';
import { prefsKey, readDashboardPrefs, type DashboardPrefs } from './model';

function load(companyId: ID): DashboardPrefs {
  try {
    return readDashboardPrefs(localStorage.getItem(prefsKey(companyId)));
  } catch {
    return readDashboardPrefs(null);
  }
}

/**
 * The period, watchlist and hidden cards this person chose for the
 * company's dashboard, kept on this device only.
 */
export function useDashboardPrefs(
  companyId: ID,
): [DashboardPrefs, (patch: Partial<DashboardPrefs>) => void] {
  const [state, setState] = useState(() => ({ companyId, prefs: load(companyId) }));
  // Another company opened: read its own choices. Adjusting state during
  // render is React's recommended pattern here.
  let current = state;
  if (state.companyId !== companyId) {
    current = { companyId, prefs: load(companyId) };
    setState(current);
  }
  const update = useCallback(
    (patch: Partial<DashboardPrefs>) =>
      setState((before) => {
        const prefs = { ...before.prefs, ...patch };
        try {
          localStorage.setItem(prefsKey(before.companyId), JSON.stringify(prefs));
        } catch {
          // Private mode: the choice holds until the page is closed.
        }
        return { ...before, prefs };
      }),
    [],
  );
  return [current.prefs, update];
}
