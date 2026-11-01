export type CliCode
  = | 'NOT_SET_UP'
    | 'INVALID_INPUT'
    | 'UNKNOWN_KIND'
    | 'ACTIVITY_NOT_FOUND'
    | 'ACTIVITY_AMBIGUOUS'
    | 'PARENT_NOT_FOUND'
    | 'PARENT_AMBIGUOUS'
    | 'DATES_INVALID'
    | 'DESTINATION_EXISTS'
    | 'WRITE_FAILED'
    | 'INTERNAL';

/** Which files a failed write touched, so a caller never has to parse prose to know what changed. */
export interface WriteReport { completed: string[]; failed?: string; untouched: string[] }

/** A refusal with a code the caller can act on. Anything else thrown becomes `INTERNAL`. */
export class CliError extends Error {
  constructor(readonly code: CliCode, message: string, readonly report?: WriteReport) {
    super(message);
  }
}

export function ok(command: string, data: unknown): string {
  return JSON.stringify({
    apiVersion: 1,
    ok: true,
    command,
    data,
  });
}

export function fail(command: string, code: CliCode, message: string, report?: WriteReport): string {
  return JSON.stringify({
    apiVersion: 1,
    ok: false,
    command,
    error: {
      code,
      message,
      ...(report
        ? { report }
        : {}),
    },
  });
}

/** Obsidian prints a thrown error as bare text and still exits 0, so every command answers in JSON instead. */
export async function answer(command: string, run: () => unknown): Promise<string> {
  try {
    return ok(command, await run());
  }
  catch (error) {
    if (error instanceof CliError)
      return fail(command, error.code, error.message, error.report);
    return fail(command, 'INTERNAL', String(error).replace(/^Error:\s*/, ''));
  }
}
