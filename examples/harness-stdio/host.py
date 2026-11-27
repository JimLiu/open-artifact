"""What this host does when the daemon calls it, and what it does with the bridge's notifications.

A real host gives a wake to its agent (a new turn for the owner, a notice for anyone else), shows `host.open`'s page
in its own window, and keeps its sessions across reconnects. This one prints a line for each, so a test (or a person)
can follow along:

    state connected | state disconnected
    reattached <session> inbox=<n>
    returned <session> <n> | kept <session> <n>
    open <url> view=<address> [remote=<type>]
    wake <turn|notice> <reason> from <kind> on "<title>"
    shell <type>
    event <type> <artifact id>
"""

import threading


def say(*words):
    print(*words, flush=True)


def route_of(payload):
    """`turn` when the owner sent it (a user message that starts a turn), else `notice`: a collaborator's comment, a
    finished task, or a message that does not say who sent it never speaks as the person."""
    source = payload.get("source") or {}
    return "turn" if (source.get("from") or {}).get("kind") == "owner" else "notice"


class Host:
    def __init__(self, sessions, peer=None):
        # session id -> workspace, for the sessions this host attached
        self.sessions = sessions
        # The Peer, for the requests the host makes when a notification comes (`inbox.return`); main.py sets it.
        self.peer = peer
        # hello's `features`: what the daemon can do (`inbox.return`, ...); main.py sets it.
        self.features = []
        # session id -> messages a reattach brought that could not be put back: a real host hands them to the
        # session's agent with its next tool result, as harness-kit does.
        self.kept = {}
        self._kept_lock = threading.Lock()
        self.connected = threading.Event()
        self.woken = threading.Event()
        self.reattached = threading.Event()

    # ---- the daemon's calls (answered) ----

    def wake_deliver(self, params):
        """`wake.deliver`: a message for one session. The owner's own request is a turn; anything else a notice."""
        if params.get("session") not in self.sessions:
            return {"status": "failed"}
        self.take_wake(params)
        # The agent here is idle and takes it at once; a busy one would queue it and still answer "delivered".
        return {"status": "delivered"}

    def take_wake(self, payload):
        source = payload.get("source") or {}
        sender = (source.get("from") or {}).get("kind", "unknown")
        say("wake %s %s from %s on \"%s\"" % (route_of(payload), source.get("reason", "?"), sender, source.get("title", "")))

    def hand_on(self, session, message):
        """Gives one inbox message to the session's agent, as a wake. False when this host cannot (it no longer has
        that session): the message then goes back to the daemon."""
        if session not in self.sessions:
            return False
        self.take_wake(message)
        return True

    def give_back(self, ref, messages):
        """`inbox.return`: what was taken on a reattach and not handed on waits in the session's inbox again, ahead of
        what came since, for its next tool call, wait or attach. Against a daemon without the feature, or when the
        request fails, they stay in `kept` for the session's next tool result instead of being lost."""
        if "inbox.return" in self.features and self.peer is not None:
            try:
                answer = self.peer.request("inbox.return", {"session": ref.get("session"), "workspace": ref.get("workspace"), "messages": messages})
                say("returned %s %d" % (ref.get("session"), (answer or {}).get("returned", 0)))
                return
            except Exception as error:  # the bridge is going away again, say: keep them rather than lose them
                say("inbox.return failed: %s" % error)
        with self._kept_lock:
            self.kept.setdefault(ref.get("session"), []).extend(messages)
        say("kept %s %d" % (ref.get("session"), len(messages)))

    def host_open(self, params):
        """`host.open`: show the artifact's page. A host with a top-level view loads `embed_url` (it carries a
        one-time ticket); one that frames the Shell loads `view_url`. A remote type's page comes from `remote.origins`,
        which a careful host lets in only after the person says yes."""
        remote = params.get("remote")
        say("open %s view=%s%s" % (params.get("url"), params.get("embed_url") or params.get("view_url"), " remote=%s" % remote["type"] if remote else ""))
        return {"opened": True}

    def shell_event(self, params):
        """`shell.event`: the Shell in a top-level view this host opened said something (a ready, a summon, ...)."""
        say("shell %s" % (params.get("event") or {}).get("type", "?"))
        return {"ok": True}

    def handlers(self):
        return {"wake.deliver": self.wake_deliver, "host.open": self.host_open, "shell.event": self.shell_event}

    # ---- the bridge's notifications ----

    def notify(self, method, params):
        if method == "bridge.state":
            say("state %s" % params.get("state"))
            (self.connected.set if params.get("state") == "connected" else self.connected.clear)()
        elif method == "bridge.reattached":
            # The daemon came back (the bridge started it again) and the bridge attached the session again; what
            # waited for it meanwhile comes along, to give to the agent like a wake.
            ref = params.get("params") or {}
            inbox = params.get("inbox") or []
            say("reattached %s inbox=%d" % (ref.get("session"), len(inbox)))
            left = [message for message in inbox if not self.hand_on(ref.get("session"), message)]
            if left:
                # Notifications come on the thread that reads the bridge: a request made here would wait for an answer
                # that thread can no longer read. Ask on a thread of its own.
                threading.Thread(target=self.give_back, args=(ref, left), daemon=True).start()
            self.reattached.set()
        elif method == "event":
            say("event %s %s" % (params.get("type"), params.get("id", "")))
