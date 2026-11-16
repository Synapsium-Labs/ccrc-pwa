# As the pinned engine's paths.py does: GRAPHIFY_OUT is read ONCE, at import. GRAPH_STUB_OUT_READ_EARLY makes the
# stub behave as if the variable had been read before the caller set it (the engine's default is what it saw).
import os

if os.environ.get('GRAPH_STUB_OUT_READ_EARLY'):
    GRAPHIFY_OUT = 'graphify-out'
else:
    GRAPHIFY_OUT = os.environ.get('GRAPHIFY_OUT', 'graphify-out')
GRAPHIFY_OUT_NAME = os.path.basename(os.path.normpath(GRAPHIFY_OUT))
