/**
 * Runs after `changeset version`: copies the new version from package.json into manifest.json and records its
 * minAppVersion in versions.json, the files Obsidian reads for installs and compatibility.
 */
import { readFile, writeFile } from 'node:fs/promises';

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const { version } = await readJson('package.json');
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version))
  throw new Error(`package.json version must be x.y.z, got ${String(version)}`);

const manifest = await readJson('manifest.json');
manifest.version = version;
await writeJson('manifest.json', manifest);

const versions = await readJson('versions.json');
versions[version] = manifest.minAppVersion;
await writeJson('versions.json', versions);
