import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { deviceTimeZone } from '../domain/time';

interface Clock {
  now: Date;
  tz: string;
}

const ClockContext = createContext<Clock>({ now: new Date(), tz: deviceTimeZone() });

/** One shared clock for every computed field, refreshed on each minute boundary and when the app comes back to the foreground. */
export function ClockProvider({ children }: { children: ReactNode }) {
  const [clock, setClock] = useState<Clock>(() => ({ now: new Date(), tz: deviceTimeZone() }));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => setClock({ now: new Date(), tz: deviceTimeZone() });
    const schedule = () => {
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, 60_000 - (Date.now() % 60_000) + 50);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}

export function useClock(): Clock {
  return useContext(ClockContext);
}
