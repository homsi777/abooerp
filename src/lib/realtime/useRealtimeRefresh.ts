import { useEffect } from 'react';
import { realtimeClient, type AppEventType } from './realtimeClient';

/**
 * When any of the listed event types arrives, calls `onRefresh`.
 * Automatically unsubscribes on component unmount.
 */
export function useRealtimeRefresh(
  events: AppEventType[],
  onRefresh: () => void,
): void {
  useEffect(() => {
    const unsubs = events.map(ev => realtimeClient.subscribe(ev, onRefresh));
    return () => unsubs.forEach(u => u());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
