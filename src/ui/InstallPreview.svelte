<script lang='ts'>
  import type { InstallPreview } from '../config/preset-install';
  import type { Profile } from '../types';
  import { resolvePath } from '../config/paths';

  const { preview, profile, confirm, cancel }: { preview: InstallPreview[]; profile: Profile; confirm: () => Promise<void>; cancel: () => void } = $props();
  let busy = $state(false);
  let error = $state('');
  const folderOf = (path: string) => path.split('/').slice(0, -1).join('/');
  const kindName = (type: Profile['types'][number]) => type.role === 'trip' && !/trip$/i.test(type.label)
    ? `${type.label} trip`
    : type.label;
  // Name each file by what it is for, not by its file name.
  function describe(file: InstallPreview): string {
    if (file.path.endsWith('.base')) {
      const users = profile.types.filter(type => type.basePath === file.path);
      return users.some(type => type.role === 'trip')
        ? 'Lists your trips'
        : `Lists a trip's ${users.map(type => type.label === 'Activity'
          ? 'activities'
          : `${type.label.toLowerCase()} notes`).join(' and ')}`;
    }
    const type = profile.types.find(item => item.template === file.path);
    return type
      ? `${kindName(type)} template`
      : file.path;
  }
  const groups = $derived([
    ...new Set(preview.map(file => folderOf(file.path))),
  ].map(folder => ({
    folder,
    kind: preview.find(file => folderOf(file.path) === folder)?.path.endsWith('.base')
      ? 'Bases'
      : 'Templates',
    files: preview.filter(file => folderOf(file.path) === folder),
  })));
  const examples = $derived(profile.types.map((type) => {
    try {
      return {
        name: kindName(type),
        path: resolvePath(type.pathPattern, {
          tripName: 'Lisbon',
          entryName: type.role === 'activity'
            ? 'Tram 28'
            : 'Alfama',
          tripStart: '2026-09-10',
          isTrip: type.role === 'trip',
        }),
      };
    }
    catch { return undefined; }
  }).filter(item => item !== undefined));
  const kept = $derived(preview.filter(file => file.action === 'reuse').length);
  async function apply() {
    busy = true;
    try {
      await confirm();
    }
    catch (cause) {
      error = String(cause).replace(/^Error:\s*/, '');
      busy = false;
    }
  }
</script>
<div class='travel-planner travel-install'>
  <p>{kept === preview.length
    ? 'All of these are already in your vault and are kept as they are.'
    : kept ? 'Adds the new files. Files already in your vault are kept as they are, never overwritten.' : 'Adds these files. Nothing else in your vault changes.'}</p>
  {#each groups as group (group.folder)}
    <h3>{group.kind} in <code>{group.folder}/</code></h3>
    <ul>{#each group.files as file (file.path)}<li><span>{describe(file)}</span> <span class='travel-install-status'>{file.action === 'reuse'
      ? 'already there, kept'
      : 'new'}</span></li>{/each}</ul>
  {/each}
  <h3>Your notes will be saved like this</h3>
  <ul>{#each examples as example (example.name)}<li><span>{example.name}</span> <code>{example.path}</code></li>{/each}</ul>
  <p class='setting-item-description'>You can change folders and templates afterwards in settings.</p>
  {#if error}<p role='alert'>{error}</p>{/if}
  <div class='modal-button-container'><button disabled={busy} onclick={cancel}>Cancel</button><button class='mod-cta' disabled={busy} onclick={() => void apply()}>{busy ? 'Installing…' : 'Install'}</button></div>
</div>
