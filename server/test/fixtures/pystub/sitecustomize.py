# DIAGNOSTIC ONLY (scratch branch ci/macos-diag-*; never merged): every python started with this stub dir on
# PYTHONPATH records when its interpreter reached `site`, then dumps all thread stacks at 1, 2, 4, 8, 16, 32 s.
import faulthandler, os, sys, threading, time
_d = "/tmp/ccgpt-diag"
try:
    os.makedirs(_d, exist_ok=True)
    _f = open(f"{_d}/py-{os.getpid()}.txt", "w", buffering=1)
    _f.write(f"site reached at {time.time():.3f} pid={os.getpid()} argv={sys.argv!r} exe={sys.executable} env_keys={sorted(os.environ)}\n")
    _steps = [1, 1, 2, 4, 8, 16]
    def _chain(i=0, elapsed=0):
        if i >= len(_steps):
            return
        def run():
            e = elapsed + _steps[i]
            _f.write(f"--- stacks at +{e}s ({time.time():.3f})\n")
            faulthandler.dump_traceback(file=_f, all_threads=True)
            _chain(i + 1, e)
        t = threading.Timer(_steps[i], run)
        t.daemon = True
        t.start()
    _chain()
except Exception as e:  # a diagnostic must never change the subject's behaviour
    pass
