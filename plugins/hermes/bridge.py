"""JSON-RPC 2.0 over `open-artifact harness --stdio`: one JSON object per line, both ways.

The host (this plugin) sends requests with ids "h1", "h2", ... and waits for their answers. The bridge sends its own
requests (`wake.deliver`, ids "d1", "d2", ...), answered here on a thread each, and notifications (`bridge.state`,
`bridge.reattached`, `event`). The bridge reconnects to the daemon by itself (starting it again when needed) and
attaches our sessions again; when the bridge process itself ends, :class:`Bridge` starts a new one on the next call.

Standard library only. stdout carries protocol only; stderr is the bridge's log and is drained to ``logging``.
"""
from __future__ import annotations

import itertools
import json
import logging
import shlex
import shutil
import subprocess
import threading
from typing import Any, Callable, Optional

logger = logging.getLogger("open_artifact.bridge")


class RpcError(Exception):
    """An error answer. ``code`` is Open Artifact's word for it (``not_granted``, ``invalid_argument``, ...)."""

    def __init__(self, error: dict):
        data = error.get("data") or {}
        super().__init__(data.get("message") or error.get("message") or "error")
        self.code = data.get("code") or str(error.get("code"))
        self.fix = data.get("fix")


class BridgeGone(RpcError):
    pass


class Bridge:
    """One `open-artifact harness --stdio` child and the conversation over its stdin/stdout.

    ``handlers`` answer the bridge's requests (method -> fn(params) -> result); ``on_notify(method, params)`` gets its
    notifications. ``hello`` is sent by :meth:`start`; a second start after the child ended sends it again.
    """

    def __init__(self, harness: str, hello: dict, handlers: dict[str, Callable[[dict], Any]],
                 on_notify: Callable[[str, dict], None], cli: Optional[str | list[str]] = None,
                 env: Optional[dict] = None):
        self.harness = harness
        self._hello = hello
        self._handlers = handlers
        self._on_notify = on_notify
        self._cli = cli
        self._env = env
        self._ids = itertools.count(1)
        self._pending: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._write = threading.Lock()
        self._start_lock = threading.Lock()
        self._proc: Optional[subprocess.Popen] = None
        self.hello_result: Optional[dict] = None
        self.connected = threading.Event()

    # ---- lifecycle ----

    def command(self) -> list[str]:
        if isinstance(self._cli, str):
            base = shlex.split(self._cli)  # OPEN_ARTIFACT_CLI: a command line
        elif self._cli:
            base = list(self._cli)  # the runtime the plugin folder carries: [node, script]
        else:
            base = [shutil.which("open-artifact") or "open-artifact"]
        return base + ["harness", "--stdio", "--harness", self.harness]

    @property
    def alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None and self.hello_result is not None

    def start(self, timeout: float = 30.0) -> dict:
        """Starts the child (if it is not running) and says hello. Returns hello's result."""
        with self._start_lock:
            if self.alive:
                return self.hello_result  # type: ignore[return-value]
            self.hello_result = None
            proc = subprocess.Popen(
                self.command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, encoding="utf-8", bufsize=1, env=self._env,
            )
            self._proc = proc
            threading.Thread(target=self._read, args=(proc,), name="open-artifact-bridge-read", daemon=True).start()
            threading.Thread(target=self._drain_stderr, args=(proc,), name="open-artifact-bridge-log", daemon=True).start()
            try:
                self.hello_result = self._request_on(proc, "hello", self._hello, timeout)
            except Exception:
                self._kill(proc)
                raise
            logger.info("open-artifact: bridge up (daemon %s, pid %s)", self.hello_result.get("daemon"), proc.pid)
            return self.hello_result

    def close(self) -> None:
        proc, self._proc = self._proc, None
        if proc is None:
            return
        try:
            proc.stdin.close()  # the bridge ends when its stdin ends; the daemon keeps running
        except (BrokenPipeError, OSError, ValueError):
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    @staticmethod
    def _kill(proc: subprocess.Popen) -> None:
        try:
            proc.kill()
        except OSError:
            pass

    @property
    def features(self) -> list[str]:
        return list((self.hello_result or {}).get("features") or [])

    # ---- requests ----

    def request(self, method: str, params: Optional[dict] = None, timeout: float = 60.0) -> Any:
        """Sends a request (starting the bridge when needed) and returns its result; raises :class:`RpcError`."""
        if not self.alive:
            self.start()
        return self._request_on(self._proc, method, params or {}, timeout)  # type: ignore[arg-type]

    def notify_async(self, method: str, params: dict, timeout: float = 15.0) -> None:
        """Fire-and-forget request (status updates, wrote reports); failures are logged at debug."""
        if not self.alive:
            return

        def run():
            try:
                self.request(method, params, timeout)
            except Exception as exc:  # noqa: BLE001
                logger.debug("open-artifact: %s failed: %s", method, exc)
        threading.Thread(target=run, name="open-artifact-async", daemon=True).start()

    def _request_on(self, proc: subprocess.Popen, method: str, params: dict, timeout: float) -> Any:
        rid = "h%d" % next(self._ids)
        waiter: dict = {"done": threading.Event(), "proc": proc}
        with self._lock:
            self._pending[rid] = waiter
        try:
            self._send(proc, {"id": rid, "method": method, "params": params}, timeout)
        except (BrokenPipeError, OSError, ValueError) as exc:
            with self._lock:
                self._pending.pop(rid, None)
            raise BridgeGone({"message": f"the bridge is gone: {exc}", "data": {"code": "disconnected"}}) from exc
        if not waiter["done"].wait(timeout):
            with self._lock:
                self._pending.pop(rid, None)
            raise TimeoutError("%s: no answer in %d s" % (method, timeout))
        if "error" in waiter:
            cls = BridgeGone if (waiter["error"].get("data") or {}).get("code") == "disconnected" else RpcError
            raise cls(waiter["error"])
        return waiter.get("result")

    def _send(self, proc: subprocess.Popen, message: dict, timeout: float = 30.0) -> None:
        """Writes one line. A child that stops reading its stdin would block the write for good: past ``timeout`` it
        is killed, which fails this write and every request waiting on it (the next call starts a new bridge)."""
        line = json.dumps(dict(jsonrpc="2.0", **message), ensure_ascii=False, separators=(",", ":"))
        if not self._write.acquire(timeout=timeout):
            self._kill(proc)
            raise BrokenPipeError("the bridge did not take a write in %d s" % timeout)
        watchdog = threading.Timer(timeout, self._kill, args=(proc,))
        watchdog.daemon = True
        watchdog.start()
        try:
            proc.stdin.write(line + "\n")
            proc.stdin.flush()
        finally:
            watchdog.cancel()
            self._write.release()

    # ---- reading ----

    def _drain_stderr(self, proc: subprocess.Popen) -> None:
        for line in proc.stderr:
            line = line.rstrip()
            if line:
                logger.debug("open-artifact bridge: %s", line[:500])

    def _read(self, proc: subprocess.Popen) -> None:
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except ValueError:
                logger.warning("open-artifact: not JSON from the bridge: %s", line[:200])
                continue
            if "method" in message:
                if message.get("id") is not None:
                    threading.Thread(target=self._answer, args=(proc, message), name="open-artifact-answer",
                                     daemon=True).start()
                else:
                    method, params = message["method"], message.get("params") or {}
                    if method == "bridge.state":
                        (self.connected.set if params.get("state") == "connected" else self.connected.clear)()
                    try:
                        self._on_notify(method, params)
                    except Exception:  # noqa: BLE001
                        logger.exception("open-artifact: notification %s failed", method)
                continue
            with self._lock:
                waiter = self._pending.pop(str(message.get("id")), None)
            if waiter is None:
                continue
            if "error" in message:
                waiter["error"] = message["error"]
            else:
                waiter["result"] = message.get("result")
            waiter["done"].set()
        # stdout ended: this bridge is gone; nothing waiting on it will be answered.
        if self._proc is proc:
            self.connected.clear()
            self.hello_result = None
        # Only what was sent to this process: a new one may already be up, with requests of its own.
        with self._lock:
            for rid, waiter in list(self._pending.items()):
                if waiter.get("proc") is not proc:
                    continue
                waiter["error"] = {"code": -32000, "message": "the bridge ended", "data": {"code": "disconnected"}}
                waiter["done"].set()
                del self._pending[rid]
        logger.info("open-artifact: bridge process ended (exit %s)", proc.poll())
        if self._proc is not proc:
            return  # an old process: the new one's sessions are attached and stay so
        try:
            self._on_notify("bridge.exited", {"code": proc.poll()})
        except Exception:  # noqa: BLE001
            logger.exception("open-artifact: bridge.exited handler failed")

    def _answer(self, proc: subprocess.Popen, message: dict) -> None:
        method = message["method"]
        handler = self._handlers.get(method)
        try:
            if handler is None:
                raise LookupError("this host does not answer %s" % method)
            result = handler(message.get("params") or {})
            self._send(proc, {"id": message["id"], "result": result})
        except Exception as error:  # noqa: BLE001 — the bridge gets an error answer instead
            logger.warning("open-artifact: answering %s failed: %s", method, error)
            try:
                self._send(proc, {"id": message["id"], "error": {
                    "code": -32000, "message": str(error), "data": {"code": "error", "message": str(error)}}})
            except Exception:  # noqa: BLE001
                pass
