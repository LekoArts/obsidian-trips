import type { FileSnapshot } from './conflicts';
import type { PropertyIO } from './properties';
import { parseProperties, splitNote } from '../config/template-render';
import { assertFresh } from './conflicts';

export type BatchStep = { before: FileSnapshot; summary: string } & (
  { kind: 'properties'; changes: Record<string, unknown>; remove?: string[] }
  | { kind: 'content'; after: string } | { kind: 'trash' }
);
export interface BatchIO extends PropertyIO {
  replace: (expected: FileSnapshot, content: string) => Promise<void>;
  /** Resolves false when the person cancels Obsidian's delete prompt. */
  trash: (expected: FileSnapshot) => Promise<boolean>;
}
export interface BatchPlan {
  steps: BatchStep[];
  sources: FileSnapshot[];
  receipts: Map<string, FileSnapshot | null>;
  applied: Set<string>;
  /** Undo only puts back bytes a receipt still guarantees; it needs no current note in the vault's index. */
  restores?: boolean;
}
/** `cancelled`: the person declined a prompt; nothing after it was written and nothing failed. */
export interface BatchReport { completed: string[]; failed?: string; untouched: string[]; error?: string; cancelled?: boolean }
class Cancelled extends Error {}
export function batchPlan(steps: BatchStep[], sources: FileSnapshot[] = []): BatchPlan {
  if (new Set(steps.map(step => step.before.path)).size !== steps.length)
    throw new Error('Combine edits to the same file before applying them');
  return {
    steps,
    sources,
    receipts: new Map(),
    applied: new Set(),
  };
}
/** The file being checked or written, so a failure names it. */
interface Cursor { path: string | undefined }

async function checkSources(io: BatchIO, plan: BatchPlan, at: Cursor): Promise<void> {
  for (const source of plan.sources) {
    at.path = source.path;
    await assertFresh(io, source);
  }
}
/** Files written by this plan must still hold what it left there, so a later step can rely on them. */
async function checkWritten(io: BatchIO, plan: BatchPlan, at: Cursor): Promise<void> {
  for (const step of plan.steps) {
    const receipt = plan.receipts.get(step.before.path);
    if (receipt === undefined || receipt === null)
      continue;
    at.path = receipt.path;
    await assertFresh(io, receipt);
  }
}
/** Every file is checked before the first write; receipts make retries absolute, not relative. */
async function preflight(io: BatchIO, plan: BatchPlan, at: Cursor): Promise<void> {
  await checkSources(io, plan, at);
  for (const step of plan.steps) {
    const path = step.before.path;
    at.path = path;
    if (plan.applied.has(path) && !plan.receipts.has(path))
      throw new Error('A write finished but couldn\'t be confirmed; nothing more was written');
    if (!plan.receipts.has(path)) {
      await assertFresh(io, step.before);
      continue;
    }
    const receipt = plan.receipts.get(path);
    if (receipt)
      await assertFresh(io, receipt);
    else if (io.exists(path))
      throw new Error('A trashed note was recreated since this edit started; nothing was undone');
  }
}
async function write(io: BatchIO, step: BatchStep): Promise<void> {
  if (step.kind === 'trash') {
    if (!(await io.trash(step.before)))
      throw new Cancelled('Kept');
    return;
  }
  if (step.kind === 'content')
    return io.replace(step.before, step.after);
  return io.updateProperties(step.before, (properties) => {
    for (const key of step.remove ?? []) Reflect.deleteProperty(properties, key);
    for (const [key, value] of Object.entries(step.changes)) {
      Object.defineProperty(properties, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  });
}
async function receipt(io: BatchIO, step: BatchStep): Promise<FileSnapshot | null> {
  if (step.kind === 'trash')
    return null;
  if (step.kind === 'content')
    return { path: step.before.path, content: step.after };
  return propertyReceipt(io, step);
}
export async function applyBatch(io: BatchIO, plan: BatchPlan): Promise<BatchReport> {
  const completed: string[] = [];
  const at: Cursor = { path: plan.steps[0]?.before.path };
  try {
    await preflight(io, plan, at);
    for (const step of plan.steps) {
      const path = step.before.path;
      if (!plan.receipts.has(path)) {
        await checkSources(io, plan, at);
        await checkWritten(io, plan, at);
        at.path = path;
        await write(io, step);
        // Marked applied before the read-back, so a write whose result can't be confirmed still blocks Retry.
        plan.applied.add(path);
        plan.receipts.set(path, await receipt(io, step));
      }
      completed.push(path);
    }
    return { completed, untouched: [] };
  }
  catch (error) {
    const failed = at.path;
    const done = plan.steps.map(step => step.before.path).filter(path => plan.applied.has(path));
    if (error instanceof Cancelled) {
      return {
        completed: done,
        untouched: plan.steps.map(step => step.before.path).filter(path => !done.includes(path)),
        cancelled: true,
      };
    }
    return {
      completed: done,
      failed,
      untouched: plan.steps.map(step => step.before.path).filter(path => !done.includes(path) && path !== failed),
      error: String(error),
    };
  }
}
/**
 * What a property write left in the file. Obsidian serialises the frontmatter itself, so the bytes are read back;
 * they only count as ours if the body is untouched and the properties are exactly the intended ones. Otherwise
 * something else wrote in between, and Retry/Undo must refuse rather than adopt that edit.
 */
async function propertyReceipt(io: BatchIO, step: BatchStep & { kind: 'properties' }): Promise<FileSnapshot> {
  const content = await io.read(step.before.path);
  const before = splitNote(step.before.content);
  const after = splitNote(content);
  const expected = parseProperties(before.yaml, io.codec);
  for (const key of step.remove ?? []) Reflect.deleteProperty(expected, key);
  Object.assign(expected, step.changes);
  const actual = parseProperties(after.yaml, io.codec);
  const same = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => JSON.stringify(a[key]) === JSON.stringify(b[key]));
  if (after.body !== before.body || !same(expected, actual))
    throw new Error(`${step.before.path} changed while it was being written`);
  return { path: step.before.path, content };
}
/**
 * The change that puts back every file a plan wrote, byte for byte. Each step only applies if the file is still
 * exactly what this plan left there, so Undo never overwrites a later edit. Trashed files can't be put back here.
 */
export function undoPlan(plan: BatchPlan): BatchPlan {
  const steps: BatchStep[] = plan.steps.filter(step => plan.applied.has(step.before.path)).map((step) => {
    const receipt = plan.receipts.get(step.before.path);
    if (receipt === null)
      throw new Error(`${step.before.path} was moved to the trash; restore it from there`);
    if (!receipt)
      throw new Error(`${step.before.path} changed while it was being written, so Undo can't put it back safely`);
    return {
      before: receipt,
      kind: 'content',
      after: step.before.content,
      summary: `Undo: ${step.summary}`,
    };
  });
  if (!steps.length)
    throw new Error('Nothing to undo');
  return {
    ...batchPlan(steps.reverse()),
    restores: true,
  };
}
