# The testbox-knobs test's one driver, run as `bash <this file> ccd/ccrc ccd/testbox-knobs <op> <arg>`: every path
# and value reaches it as an argument, never spliced into a script. $1 ccd/ccrc, $2 ccd/testbox-knobs (or a copy),
# $3 the operation, $4 its argument. PROG is the wrapper's, as `ccrc test --testbox-knobs` runs it (ccd/ccrc sets
# its own when sourced).
. "$1" || exit 90
PROG="ccrc test"
. "$2" || exit 91
case "$3" in
  knobs) _testbox_knobs "$4"; exit $? ;;
  owner) _tb_box_owner_uid ;;
  fileok) if _tb_box_file_ok "$4"; then echo ok; else printf 'refused\t%s\n' "$TB_BOX_WHY"; fi ;;
  envfile) _tb_box_env_file ;;
  *) exit 93 ;;
esac
