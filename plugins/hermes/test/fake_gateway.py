"""The plugin in a fake Hermes gateway, against a real daemon (OPEN_ARTIFACT_HOME and OPEN_ARTIFACT_CLI from the test).

A fake plugin context records register_tool / register_hook / inject_message, as Hermes's PluginContext does. One line
per step on stdout; the first failure exits non-zero.

  routing    only the owner's words reach inject_message; a collaborator, the system or no sender answers failed
  failed-call a tool call that fails (error answer, bridge gone, timeout) is sent once, and what its attach took from
              the inbox goes back with inbox.return
  register   three tools in the open_artifact toolset and the three hooks; in the "gateway" the bridge comes up
  tools      quickstart (attaches the session), then publish: an artifact this session owns
  live       the page's Ask (artifacts.ask) -> wake.deliver -> inject_message(user, session_key) -> via live
  inbox      the host refuses -> failed -> it waits in the inbox; the next turn's pre_llm_call hands it over as data
"""
import importlib.util
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent
SESSION = "agent:main:test:dm:1"
WORK = Path(os.environ["OA_TEST_WORK"])


def say(*words):
    print(*words, flush=True)


def fail(message):
    say("FAIL", message)
    sys.exit(1)


class FakeManager:
    _cli_ref = None
    has_gateway_message_injector = True


class FakeCtx:
    def __init__(self):
        self._manager = FakeManager()
        self.tools, self.hooks, self.injected, self.unload = {}, {}, [], []
        self.allow = True

    def register_tool(self, name, toolset, schema, handler, **_kw):
        self.tools[name] = (toolset, schema, handler)

    def register_hook(self, name, callback, **_kw):
        self.hooks.setdefault(name, []).append(callback)

    def inject_message(self, content, role="user", *, session_key=None, origin=None):
        self.injected.append({"content": content, "role": role, "session_key": session_key})
        return self.allow

    def session_cwd(self):
        return str(WORK)

    def on_unload(self, callback):
        self.unload.append(callback)


def load():
    spec = importlib.util.spec_from_file_location("open_artifact_hermes", PLUGIN / "__init__.py",
                                                  submodule_search_locations=[str(PLUGIN)])
    module = importlib.util.module_from_spec(spec)
    sys.modules["open_artifact_hermes"] = module
    spec.loader.exec_module(module)
    return module


def daemon_api(name, body):
    state = json.loads((Path(os.environ["OPEN_ARTIFACT_HOME"]) / "daemon.json").read_text())
    request = urllib.request.Request(state["url"] + "/api/open-artifact." + name, data=json.dumps(body).encode(),
                                     headers={"Authorization": "Bearer " + state["token"], "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def until(check, timeout=20.0):
    end = time.time() + timeout
    while time.time() < end:
        value = check()
        if value:
            return value
        time.sleep(0.05)
    return None


def main():
    module = load()

    # routing: an adapter on its own, nothing spawned
    ctx = FakeCtx()
    adapter = module.Adapter(ctx, data_dir=WORK / "routing")
    for sender, want in (({"kind": "owner"}, "delivered"), ({"kind": "collaborator", "name": "Ann", "role": "comment"}, "failed"),
                         ({"kind": "system"}, "failed"), (None, "failed")):
        source = {"reason": "comment", **({"from": sender} if sender else {})}
        got = adapter.on_wake({"session": "s1", "text": "hi", "source": source})["status"]
        if got != want:
            fail("routing %s: %s" % (sender, got))
    if [i["role"] for i in ctx.injected] != ["user"] or ctx.injected[0]["session_key"] != "s1":
        fail("routing: inject calls %s" % ctx.injected)
    say("routing ok")

    # failed call: what the attach took goes back to the inbox; the call is not sent twice
    class StubBridge:
        alive = True
        features = ["inbox.return"]
        hello_result = {"daemon": "stub"}

        def __init__(self, failure):
            self.calls, self.failure = [], failure

        def request(self, method, params=None, timeout=60.0):
            self.calls.append((method, params))
            if method == "session.attach":
                return {"inbox": [{"kind": "wake", "text": "waited", "at": "2026-01-01T00:00:00.000Z"}]}
            if method == "tools.call":
                raise self.failure
            return {"ok": True}

    for failure in (module.RpcError({"message": "no", "data": {"code": "invalid_argument"}}),
                    module.BridgeGone({"message": "gone", "data": {"code": "disconnected"}}),
                    TimeoutError("slow")):
        adapter = module.Adapter(FakeCtx(), data_dir=WORK / "stub")
        adapter.bridge = StubBridge(failure)
        out = json.loads(adapter.call_tool("Artifact", {"action": "publish"}, "s2", str(WORK)))
        methods = [m for m, _ in adapter.bridge.calls]
        returned = [p for m, p in adapter.bridge.calls if m == "inbox.return"]
        if "error" not in out or methods.count("tools.call") != 1 or len(returned) != 1 or \
                [m["text"] for m in returned[0]["messages"]] != ["waited"]:
            fail("failed call (%s): %s %s" % (type(failure).__name__, out, methods))
    say("failed-call ok")

    # register
    ctx = FakeCtx()
    module.register(ctx)
    if sorted(ctx.tools) != ["Artifact", "ArtifactComments", "ArtifactData"] or {t[0] for t in ctx.tools.values()} != {"open_artifact"}:
        fail("register: tools %s" % sorted(ctx.tools))
    if sorted(ctx.hooks) != ["on_session_end", "post_tool_call", "pre_llm_call"]:
        fail("register: hooks %s" % sorted(ctx.hooks))
    adapter = module._ADAPTER
    if not until(lambda: adapter.bridge.alive, 60):
        fail("register: the bridge did not come up")
    say("register ok daemon=%s inbox.return=%s" % (adapter.bridge.hello_result.get("daemon"), "inbox.return" in adapter.bridge.features))

    def tool(name, args):
        return json.loads(ctx.tools[name][2](args, session_id=SESSION))

    quick = tool("Artifact", {"action": "quickstart", "type": "note"})
    if quick.get("error") or not quick.get("create"):
        fail("quickstart: %s" % json.dumps(quick)[:300])
    made = tool("Artifact", dict(quick["create"], title="Hello from Hermes", open="never", folder=str(WORK / "hello")))
    if made.get("error") or not made.get("url"):
        fail("publish: %s" % json.dumps(made)[:300])
    artifact = made["url"].rsplit("/", 1)[-1]
    say("tools ok attached=%s" % (SESSION in adapter.attached))

    before = len(ctx.injected)
    answer = daemon_api("artifacts.ask", {"id": artifact, "text": "Make the title bigger"})
    if not until(lambda: len(ctx.injected) > before, 15):
        fail("live: nothing injected (%s)" % answer)
    injected = ctx.injected[-1]
    if answer.get("via") != "live" or injected["role"] != "user" or injected["session_key"] != SESSION:
        fail("live: %s %s" % (answer, injected))
    say("live ok via=%s" % answer["via"])

    ctx.allow = False
    time.sleep(0.2)
    answer = daemon_api("artifacts.ask", {"id": artifact, "text": "Second request, while the host refuses"})
    if answer.get("via") != "inbox":
        fail("inbox: %s" % answer)
    ctx.allow = True
    notice = ctx.hooks["pre_llm_call"][0](session_id=SESSION)
    text = (notice or {}).get("context", "")
    if "Second request" not in text or not text.startswith("[Open Artifact:"):
        fail("inbox: pre_llm_call gave %r" % (notice,))
    if ctx.hooks["pre_llm_call"][0](session_id=SESSION):
        fail("inbox: handed over twice")
    say("inbox ok")

    for callback in ctx.unload:
        callback()
    say("PASS")


if __name__ == "__main__":
    main()
