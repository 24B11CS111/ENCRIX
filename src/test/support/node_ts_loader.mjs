export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    try {
      return await nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    } catch {
      // Fall through to normal resolution for actual JavaScript modules.
    }
  }

  return nextResolve(specifier, context);
}
