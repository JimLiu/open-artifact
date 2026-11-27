# Remixing a dashboard into another format

A remix shows what this dashboard already shows, in another of its own formats. A format is a shape of the page, so it's still the same artifact. The page asks for a remix in the `request` field of its message, which names the format and a draft, `drafts/<id>`. The formats are:

- Dashboard, the usual dashboard, whatever its shape.
- Scrollyteller (the Scroll story) and Visual analysis, in `reference/design-defaults.md`.
- Visual short, in `reference/visual-short.md`.

Every format is offered whatever the page is now, so picking the one it already has is a request for a fresh take: the same figures in a new order, drawn another way where that reads better. Before you write, read the format's description, and `reference/one-writer.md` as for any new page.

## The draft

Other people may have this dashboard open, so the remix is written beside it as a draft, which changes nothing for them until an editor presses Save. Only that `request` starts a draft. If a person asks for another format in the chat there is none, and the change replaces the page for everyone as you write it, so they need to hear that before you write.

Each request is a new draft with a new id, made from the dashboard and not from an earlier draft. The page wrote `drafts/<id>` when the format was picked, and the draft is wanted for as long as that document is there. The request's `selection` names it again as `writeTo: "drafts/<id>"`, the same id as in the request: that is where every write of this remix goes. So read it (`get` `drafts/<id>`) before each round of writes. If it's missing, the draft was saved, canceled, replaced or never begun, and no page would show what you write. Tell the person, who can pick a format under Design again.

A draft holds these documents, and anything else you write in it, such as a title or a look, is ignored:

- **The page**, in collection `drafts/<id>/files`: doc `index.html`, with any `.css` or `.js` it names beside it. These files are the whole page. None of the old page's files load with it, so copy in each `dash.calc`, `dash.loader` or helper it needs.
- **A source that is new, or whose call changes**, at `drafts/<id>/datasets/<dataset id>`. It replaces the dashboard's whole document, so write all of it. Every other source is the dashboard's own, read by its id.
- **Changed filter defaults**, in collection `drafts/<id>/dash`, doc `params`, which replaces all of the defaults.

A write or a delete in the dashboard's own `files/`, `datasets/` or `dash/` shows to everyone at once, and so does every saved row: those never go into a draft.

## Who sees what

Everyone who can edit the dashboard can see the draft, and nobody else can. The person who asked sees it on their page once it has an `index.html`, which also replaces any earlier draft of theirs, and the page draws it again after each write. It waits while they edit, comment or look at an earlier version. Until it shows, their `check`, `runs` and `page` still describe the dashboard, however new the `at`. While it shows, they describe the draft, and all three say so with `showing: "drafts/<id>"`. An earlier version on the page gives `showing: "history/<n>"` and never a `writeTo`: it is only being looked at, so a change asked for then is to the dashboard itself.

While the view context holds `writeTo: "drafts/<id>"`, the person is looking at that draft (`showing` and `draft` name it too), so the changes they ask for belong in it. Without `writeTo` they see the dashboard itself, even if a draft exists, and mean that unless they speak of the draft. Say which of the two you changed. The heading on the page is the draft's own, but the dashboard's name, `dash/meta`, isn't part of a draft. A new name shows to everyone at once, so change it only when they ask for the name, and tell them that first.

In the top bar, Save copies the draft over the dashboard for everyone and removes the old page's files. Other sources stay, and History keeps the dashboard as it was. Cancel discards the draft for good, and Undo and Redo switch between the dashboard and the draft. They decide whether to press Save from what you tell them as you hand it over: that people who can edit the dashboard can see the draft, what those buttons do, and what the new page leaves out.

## What carries over

Explore the data before you plan the page, with queries of your own where they help, and let what you learn inform the design. The rule on personal fields in `SKILL.md` holds for those queries too.

People who know the dashboard will compare the two. So keep each calc's `id` and `fn` and each dataset's call as they are, unless the format's description says otherwise.

A story carries less than a dashboard. Start from what the dashboard is for, choose the finding it serves, and keep what tells it. Tiles often fold into sentences, and a table people look things up in can stand at the foot of a page that scrolls.

A story often drops the filters. A figure measured over a filter's default, like “+22% since 2006”, is a different number over all the data, so it keeps that base or its sentence says the new one. A finding typed as text goes stale beside live numbers, so the words that turn on the data, headlines too, are filled from it.

Another format can leave sources unread, and they stay in `datasets/`. A Dashboard is where they come back, with controls for the `{{name}}`s their queries take, since it can show all that is there and not only what the page reads.

## The shared draft

When people who can edit the dashboard have it open, their page keeps one draft that they all work in: `drafts/shared`, whose head has `kind: "edit"`. Their hand edits go into it, and while the view context holds `writeTo: "drafts/shared"`, so do your changes. Nobody else sees them until someone publishes the draft. Publishing or discarding empties it, and the id stays `shared`.

The page keeps the head up to date. It records there who has changed the draft (`editors`, plus `agent` after your first write), so don't write the head, but read it with `get` ahead of every batch of writes, just like a remix head. When it has disappeared, write nothing and tell the person; their next message will say where changes go now. Read again, too, each draft document your change was based on. If one has vanished, or your change is no longer in it, someone has published, discarded or undone the draft in the meantime: tell them, then read the document afresh, from the draft if it is there, otherwise from the dashboard.

Heads beside it with `kind: "past"` are how the page remembers drafts that were published or discarded. Leave them alone and never bring one back yourself: that is an editor's choice, made with Restore in History.

Everything else in this file applies to it, apart from these points:

- **Viewers can look at it too.** Anyone who can open the dashboard but can't edit sees it after pressing See draft, and any query it adds or changes runs under that person's own access. Editors are shown it from the start. Other people may already have changes in it, made in their own chats or with the pencil, which saves every hand edit into it straight away. Keep those changes, and read a file right before writing it: a copy read earlier would wipe out whatever was typed since.
- **Page files in the draft are edited the way the dashboard's are.** When a turn of yours starts, the open page next to this chat copies every page file missing from the draft into `drafts/shared/files/<name>`, with a `copy` mark, so one `str_replace` on its `text` can change a single passage. An untouched copy is not a change. The copy can take a few seconds to show up; if it isn't there, read again. If it never arrives, write the full file there yourself, without `edit` or `copy`, and when it is too large for that, tell the person. Never edit the dashboard's own `files/<name>` instead: everyone would see that immediately.
- **Apart from page files, it holds differences only.** For a new source or new filter defaults, read `datasets/<dataset id>` or `dash/params` from the draft, or from the dashboard when the draft lacks it, and write the full changed document into the draft, leaving out its `edit` field (that field is how a person's page marks itself as the writer). Anything missing from the draft comes from the dashboard.
- **Nothing is removed through it.** A file or source the page stops naming is kept and simply not read.
- **A discard can be reversed.** Discarding clears the draft for all, and History shows what was cleared, with a Restore that returns it to the draft.
- **A menu sits beside Publish.** Its See published lets someone see the dashboard the way everybody else does, while the draft is kept. Undo and Redo (the usual shortcuts, or two buttons next to the menu) move one step at a time through what that one person changed in the draft, a step for each of your turns or each pencil session, until the page reloads or the draft gets published or discarded.

When you hand over, say how the change will reach everyone. With the page beside this chat open, the draft is published automatically when your turn ends, unless `dash/settings` has `autoPublish: false`, someone else's changes are in the draft too, or the dashboard has changed since the draft began. In those cases the change waits until someone presses Publish in the top bar. If auto-publish is on and the draft is empty when your turn starts, the view context has no `writeTo`, and what you write lands on the dashboard straight away.
