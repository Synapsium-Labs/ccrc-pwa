// server/test/fixtures/history/preload-throwwrite.mjs — TEST-ONLY. Loaded with `--import <this file>`; NEVER shipped, and nothing under
// ccd/ reads the variable below.
//
// HISTORY_TEST_THROW_WRITE=<marker>
//   process.stdout.write throws once a chunk that holds <marker> is written. The CLI's relay writes the shim's stdout lines there,
//   so the throw lands inside the relay's own stream handler: the CLI's error path (D-5022, ruling 5020), driven without a fault in
//   shipped code.
// HISTORY_TEST_THROW_WRITE_DETAIL=<text> (optional)
//   appended to the thrown message, so a test can make a throw carry a value the CLI's error line must mask.
const marker = process.env.HISTORY_TEST_THROW_WRITE;
if (marker) {
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = function throwWrite(chunk, ...rest) {
    if (String(chunk).includes(marker)) throw new Error(`preload-throwwrite: refused a write holding ${marker}${process.env.HISTORY_TEST_THROW_WRITE_DETAIL ?? ''}`);
    return real(chunk, ...rest);
  };
}
