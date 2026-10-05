// Pushes one registration on the Autumn React queue.
// The loader can run before or after this file.
export function register(entry) {
  let queue;
  try {
    queue = window.autumnReact;
    // An element or a frame named "autumnReact" can clobber the global.
    if (!Array.isArray(queue) && queue?.loader !== true) queue = undefined;
  } catch {
    // A cross-origin frame named "autumnReact" throws on access.
    queue = undefined;
  }
  if (!queue) queue = window.autumnReact = [];
  queue.push(entry);
}
