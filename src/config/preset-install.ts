import { presetFiles } from './bundled-preset';
import { filled, validatePath } from './validation';

export interface InstallIO {
  read: (path: string) => Promise<string>;
  exists: (path: string) => boolean;
  create: (path: string, content: string) => Promise<void>;
}
export interface InstallFile { path: string; content: string }
export interface InstallPreview extends InstallFile { action: 'create' | 'reuse'; different: boolean; existingContent?: string }

export function bundledPreset(): InstallFile[] {
  return presetFiles.map(file => ({ ...file }));
}

export async function previewInstall(io: InstallIO, files = bundledPreset()): Promise<InstallPreview[]> {
  const paths = new Set<string>();
  return Promise.all(files.map(async (file) => {
    if (validatePath(file.path).length || paths.has(file.path))
      throw new Error('Invalid or duplicate preset destination');
    paths.add(file.path);
    const exists = io.exists(file.path);
    const existingContent = exists
      ? await io.read(file.path)
      : undefined;
    return {
      ...file,
      action: exists ? 'reuse' : 'create',
      different: exists && existingContent !== file.content,
      existingContent,
    };
  }));
}
export async function installPreview(io: InstallIO, preview: InstallPreview[]): Promise<{ completed: string[]; failed?: string; untouched: string[] }> {
  const completed: string[] = [];
  for (const [index, file] of preview.entries()) {
    if (file.action === 'reuse')
      continue;
    try {
      if (io.exists(file.path))
        throw new Error('Destination appeared after preview');
      await io.create(file.path, file.content);
      completed.push(file.path);
    }
    catch (error) {
      return {
        completed,
        failed: `${file.path}: ${String(error)}`,
        untouched: preview.slice(index + 1).filter(f => f.action === 'create').map(f => f.path),
      };
    }
  }
  return { completed, untouched: [] };
}

export function validateTemplateLinks(content: string, resolve: (target: string) => string | undefined): string[] {
  const targets = [
    ...content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g),
  ].map(match => match[1] ?? '');
  return targets.filter(target => !filled(resolve(target))).map(target => `Unresolved template link: ${target}`);
}
