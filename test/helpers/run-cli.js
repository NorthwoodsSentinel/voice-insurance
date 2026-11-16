// Runs bin/cli.js in-process so coverage can measure it.
//
// Why: the CLI does its work at import time (it reads process.argv, prints
// and calls process.exit). Running it as a child process would leave it
// unmeasured, so this helper sets argv, captures console output, turns
// process.exit into a thrown error, optionally swaps in a fake stdin, and
// imports a fresh copy of the module. The CLI source is not changed for this.
import { Readable } from "node:stream";
import { vi } from "vitest";

class ExitCalled extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

/**
 * @param {string[]} argv arguments after the program name
 * @param {{ stdin?: string, tty?: boolean, cwd?: string }} [options]
 *   stdin: text the fake stdin yields; tty: mark stdin as a terminal;
 *   cwd: working directory for the run
 * @returns {Promise<{ code: number | undefined, out: string, err: string }>}
 */
export async function runCli(argv, options = {}) {
  const out = [];
  const err = [];
  const savedArgv = process.argv;
  const savedCwd = process.cwd();
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");
  vi.spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a) => {
    err.push(a.join(" "));
  });
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ExitCalled(code);
  });
  const fakeStdin = Readable.from(
    options.stdin === undefined ? [] : [Buffer.from(options.stdin, "utf8")],
  );
  Object.assign(fakeStdin, { isTTY: options.tty ?? false });
  Object.defineProperty(process, "stdin", {
    configurable: true,
    get: () => fakeStdin,
  });
  process.argv = ["node", "voice-insurance", ...argv];
  if (options.cwd) process.chdir(options.cwd);

  let code;
  try {
    vi.resetModules();
    await import("../../bin/cli.js");
  } catch (e) {
    if (!(e instanceof ExitCalled)) throw e;
    code = e.code;
  } finally {
    process.argv = savedArgv;
    process.chdir(savedCwd);
    Object.defineProperty(process, "stdin", stdinDescriptor);
    vi.restoreAllMocks();
  }
  return { code, out: out.join("\n"), err: err.join("\n") };
}
