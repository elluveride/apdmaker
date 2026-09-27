/**
 * Set VITE_EMBEDDED=true when the app runs inside a sandboxed frame that
 * blocks downloads and printing, like a claude.ai artifact. Printing is then
 * hidden, and files are saved through the viewer's save prompt where it
 * offers one (see io/save.ts); otherwise saving is hidden too.
 */
export const EMBEDDED = import.meta.env.VITE_EMBEDDED === 'true';
