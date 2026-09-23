/**
 * Set VITE_EMBEDDED=true when the app runs inside a sandboxed frame that
 * blocks downloads and printing; those controls are then hidden.
 */
export const EMBEDDED = import.meta.env.VITE_EMBEDDED === 'true';
