// server/test/fixtures/history/preload-throwwrite.mjs — TEST-ONLY. Loaded with `--import <this file>`; NEVER shipped, and nothing under
// ccd/ reads the variable below.
//
// HISTORY_TEST_THROW_WRITE=<marker>
//   process.stdout.write throws once a chunk that holds <marker> is written. The CLI's relay writes the shim's stdout lines there,
//   so the throw lands inside the relay's own stream handler: the CLI's error path (D-5022, ruling 5020), driven without a fault in
//   shipped code.
// HISTORY_TEST_THROW_WRITE_DETAIL=<text> (optional)
//   appended to the thrown message, so a test can make a throw carry a value the CLI's error line must mask.
// HISTORY_TEST_THROW_WRITE_ONCE=1 (optional)
//   the throw happens for the first such chunk only; a later one is written. Without it every chunk holding <marker> throws, so a
//   line the relay held back can never be written, and a leak of it after the throw would not show.
// HISTORY_TEST_EXIT_DELAY_MS=<n> (optional)
//   process.exit() ends the process <n> ms later instead of at once (the exit code is the one it was given, or process.exitCode). It
//   holds the CLI alive in the window between its error line and its end, where a stream listener left attached could still write.
const marker = process.env.HISTORY_TEST_THROW_WRITE;
if (marker) {
  const real = process.stdout.write.bind(process.stdout);
  let thrown = false;
  process.stdout.write = function throwWrite(chunk, ...rest) {
    if (String(chunk).includes(marker) && !(thrown && process.env.HISTORY_TEST_THROW_WRITE_ONCE === '1')) {
      thrown = true;
      throw new Error(`preload-throwwrite: refused a write holding ${marker}${process.env.HISTORY_TEST_THROW_WRITE_DETAIL ?? ''}`);
    }
    return real(chunk, ...rest);
  };
}

const exitDelay = Number(process.env.HISTORY_TEST_EXIT_DELAY_MS ?? 0);
if (exitDelay > 0) {
  const realExit = process.exit.bind(process);
  process.exit = function delayedExit(...args) {
    setTimeout(() => realExit(...args), exitDelay);   // the arguments as given: an explicit undefined would reset process.exitCode
  };
}
