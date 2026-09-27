import { EMBEDDED } from '../env';

/**
 * How files leave the app: a plain browser download, or, when the app runs as
 * a claude.ai artifact (whose frame blocks downloads), the viewer's own save
 * prompt from the artifact's `downloads` capability.
 */

interface ViewerDownloads {
  save(request: { filename: string; data: Blob | string }): Promise<{ status: 'saved' | 'delivered' }>;
}

interface ArtifactHost {
  use(name: 'downloads'): Promise<ViewerDownloads | null>;
}

let viewer: Promise<ViewerDownloads | null> | null = null;

/** The claude.ai viewer's save prompt, or null outside a viewer that offers one. */
function viewerDownloads(): Promise<ViewerDownloads | null> {
  viewer ??= (async () => {
    const host = (window as unknown as { claude?: ArtifactHost }).claude;
    if (typeof host?.use !== 'function') return null;
    try {
      return await host.use('downloads');
    } catch {
      return null;
    }
  })();
  return viewer;
}

/** Whether files can be saved here: always in a normal browser tab; in a sandboxed frame only through the viewer. */
export async function canSaveFiles(): Promise<boolean> {
  return !EMBEDDED || (await viewerDownloads()) !== null;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export interface SaveOutcome {
  filename: string;
  /** False when the viewer turned the save prompt down. */
  saved: boolean;
}

/** Hand a file to the viewer: through the viewer's save prompt where there is one, as a download otherwise. */
export async function saveFile(blob: Blob, filename: string): Promise<SaveOutcome> {
  const downloads = await viewerDownloads();
  if (!downloads) {
    download(blob, filename);
    return { filename, saved: true };
  }
  try {
    await downloads.save({ filename, data: blob });
    return { filename, saved: true };
  } catch (err) {
    const { code, message } = err as { code?: string; message?: string };
    if (code === 'declined') return { filename, saved: false };
    if (code === 'rate_limited') throw new Error('A save prompt is already open. Finish that one first.');
    throw new Error(message || 'Could not save that file here.');
  }
}
