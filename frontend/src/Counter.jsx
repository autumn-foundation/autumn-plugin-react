import { useId, useState } from 'react';

// A counter with local state. `start` and `label` come from the server.
export function Counter({ label = 'Count', start = 0 }) {
  const [count, setCount] = useState(start);
  const id = useId();
  return (
    <div className="island-counter">
      <span id={id}>{label}</span>{' '}
      <output aria-labelledby={id}>{count}</output>{' '}
      <button type="button" onClick={() => setCount(count + 1)}>
        Add one
      </button>
    </div>
  );
}
