function resolvePath(value, base) {
  const specifier = `${value}`;
  return /^(?:\.{1,2}\/|\/)/.test(specifier) ? new URL(specifier, base).href : specifier;
}

export function prepare(meta, base, run) {
  if (!document.querySelector(`script[data-playground-run="${run}"]`)) {
    throw new Error('Game run was replaced');
  }
  meta.url = base;
  const { resolve } = meta;
  if (resolve) meta.resolve = value => resolve(resolvePath(value, base));
}

export function dynamicSpecifier(value, base) {
  // Let native import() coerce the specifier so conversion errors reject its promise.
  return { __proto__: null, toString: () => resolvePath(value, base) };
}
