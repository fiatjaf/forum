# forum

A simple forum client. Anyone can use it to start a forum, public or private,
on any compatible open server, and invite people to it.

- Threads with nested comments and upvotes, like Hacker News and Reddit.
- Public forums can be read by anyone with the link. Private forums only by
  members.
- Open forums let anyone join. Closed forums need an invite link, or an admin
  to add you.
- Admins can rename the forum, add and remove members, make invite links and
  delete posts.
- New threads and comments show up live, with no page reload.
- Notifications for replies, comments on your threads and mentions, with
  optional desktop alerts.
- Search, dark mode, and no sign-up: a key is made in your browser the first
  time you open it. You can also log in with an existing key, a remote signer
  or Google.

## Servers

The forum lives on a server, not in this app. The app only talks to it. Any
server that supports [NIP-29](https://github.com/nostr-protocol/nips/blob/master/29.md)
groups works, and each forum is one of those groups.

Every thread and comment is signed by the person who wrote it, so a forum is
not tied to its server. You can move it later to another server, or to one you
run yourself, such as [pyramid](https://github.com/fiatjaf/pyramid), and share
the new link.

## Running

```sh
bun install
bun run dev
```

`bun run build` makes a static site in `dist/`. Serve it from any web server
that sends `index.html` for every path.

## Licence

[AGPL-3.0](LICENSE).
