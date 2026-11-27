"""bridge.py on its own, without a daemon. One line per case on stdout; the first failure exits non-zero.

  stale-exit  an old bridge process that ends fails only the requests sent to it, not its replacement's
  stuck-write a child that stops reading its stdin: a write gives up within its deadline and the child is killed
"""
import importlib.util
import subprocess
import sys
import threading
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location("oa_bridge", Path(__file__).resolve().parent.parent / "bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def fail(message):
    print("FAIL", message, flush=True)
    sys.exit(1)


class Ended:
    """A process whose stdout is at its end."""
    stdout = iter(())

    def poll(self):
        return 0


notices = []
b = bridge.Bridge("x", {}, {}, lambda method, params: notices.append(method))
old, new = Ended(), object()
b._proc = new
b._pending["h1"] = {"done": threading.Event(), "proc": old}
replacement = {"done": threading.Event(), "proc": new}
b._pending["h2"] = replacement
b._read(old)
if "h1" in b._pending or "h2" not in b._pending or replacement["done"].is_set() or "bridge.exited" in notices:
    fail("stale-exit: %s %s" % (sorted(b._pending), notices))
print("stale-exit ok", flush=True)

child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, text=True, bufsize=1)
started = time.time()
try:
    b._send(child, {"id": "h3", "method": "x", "params": {"big": "x" * (4 << 20)}}, 1.0)
    fail("stuck-write: the write went through")
except (BrokenPipeError, OSError, ValueError):
    pass
took = time.time() - started
child.wait(5)
if took > 10 or child.poll() is None:
    fail("stuck-write: %.1fs, child alive=%s" % (took, child.poll() is None))
print("stuck-write ok", flush=True)
