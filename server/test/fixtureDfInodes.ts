/** The `df -Pi <path>` answer every fixture `df` stub shares. The disk check asks
 *  `df -Pk` and `df -Pi` of each work root (D-6618); a stub that refuses `-Pi`
 *  makes a fresh fixture box print a WARN no test of those suites meant to see.
 *  Shell builtins only, as the stubs' PATH holds no system directory. Placed
 *  before a stub's own `-Pk` handling. */
export const FIXTURE_DF_INODES_LINES: string[] = [
  'if [ "$1" = "-Pi" ] && [ -n "$2" ]; then',
  '  echo "Filesystem      Inodes IUsed   IFree IUse% Mounted on"',
  '  echo "/dev/fixture0  1000000 10000  990000    1% /"',
  '  exit 0',
  'fi',
];
