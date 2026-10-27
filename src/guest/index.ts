/**
 * The guest software shipped with the workshop: VC-8 assembly sources for
 * the boot firmware, the kernel, user programs and examples. Bundled as text
 * so they work offline and can be edited and rebuilt in the browser.
 */
const modules = import.meta.glob('./**/*.{asm,inc}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Path (e.g. "kernel/main.asm") → source text. */
export const GUEST_SOURCES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(modules)
      .map(([k, v]) => [k.replace(/^\.\//, ''), v] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  ),
);

export const FIRMWARE_MAIN = 'firmware/bios.asm';
export const KERNEL_MAIN = 'kernel/main.asm';
