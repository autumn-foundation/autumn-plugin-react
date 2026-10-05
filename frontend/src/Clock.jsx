import { useEffect, useState } from 'react';

// Ticks each second. The cleanup stops the timer when htmx removes it.
export function Clock({ zone = 'UTC' }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const text = now.toLocaleTimeString('en-GB', { timeZone: zone });
  return (
    <time className="island-clock" dateTime={now.toISOString()}>
      {zone}: {text}
    </time>
  );
}
