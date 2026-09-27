/**
 * Set VITE_EMBEDDED=true when the app runs inside a sandboxed frame that
 * blocks downloads and printing, like a claude.ai artifact. Printing is then
 * hidden, and files are saved through the viewer's save prompt where it
 * offers one (see io/save.ts); otherwise saving is hidden too.
 */
export const EMBEDDED = import.meta.env.VITE_EMBEDDED === 'true';

/**
 * Set VITE_ARTIFACT_RUNTIME=true as well to reach the claude.ai viewer's
 * runtime for its save prompt; publish the page with the `downloads`
 * capability then. Left out, the page never touches the runtime and saves by
 * hand in a sandboxed frame.
 */
export const ARTIFACT_RUNTIME = import.meta.env.VITE_ARTIFACT_RUNTIME === 'true';
