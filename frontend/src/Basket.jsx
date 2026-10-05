import { useState } from 'react';

// The server sends new `items` with `PropsUpdate`. The open state stays.
export function Basket({ items = [] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="island-basket">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Basket ({items.length})
      </button>
      {open && (
        <ul>
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
