// Pushes one registration on the Autumn React queue.
// The loader can run before or after this file.
export function register(entry) {
  let queue = window.autumnReact;
  // An element with id="autumnReact" can clobber the global. Check it.
  if (!Array.isArray(queue) && queue?.loader !== true) {
    queue = window.autumnReact = [];
  }
  queue.push(entry);
}
