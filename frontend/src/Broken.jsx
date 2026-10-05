// Throws during render. The loader puts the server fallback back.
export function Broken() {
  throw new Error('Broken: this component always fails');
}
