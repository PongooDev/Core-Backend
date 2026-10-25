// A later build's game data is kept as the differences from Cert's (gamedata/<changelist>/<name>.json), in the JSON Merge
// Patch form (RFC 7396): an object merges into the one it replaces key by key, null removes a key, anything else
// (arrays, numbers, strings) replaces the value whole. The extracted data never holds null, so every difference fits.
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Keys the patch doesn't name keep Cert's values (the same objects, not copies).
export function applyPatch(target, patch) {
  if (!isObject(patch)) return patch;
  const out = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = applyPatch(out[key], value);
  }
  return out;
}

export function sameValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameValue(value, b[i]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

// The patch that turns source into target (undefined when they are the same).
export function createPatch(source, target) {
  if (sameValue(source, target)) return undefined;
  if (!isObject(source) || !isObject(target)) return target;
  const patch = {};
  for (const key of Object.keys(source)) if (!Object.hasOwn(target, key)) patch[key] = null;
  for (const [key, value] of Object.entries(target)) {
    const change = Object.hasOwn(source, key) ? createPatch(source[key], value) : value;
    if (change !== undefined) patch[key] = change;
  }
  return patch;
}
