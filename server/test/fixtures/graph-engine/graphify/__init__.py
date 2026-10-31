# A stub of the pinned graph engine for server/test/graph-build.test.ts (D-7349). Not the real package: it keeps
# only the surface ccd/graph-build touches (graphify.paths.GRAPHIFY_OUT and graphify.watch._rebuild_code) and
# records what the wrapper did with it. Importing it appends one `import` record, so a row can prove that the
# wrapper did NOT import the engine (the slot-wait refusal), and what oom_score_adj the process had AT import
# (the wrapper must raise it before the engine is imported).
from graphify import _record

_record.append({'event': 'import', 'oom_score_adj': _record.oom_score_adj()})
