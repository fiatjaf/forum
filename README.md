# forum

A forum that lives on [NIP-29](https://nips.nostr.com/29) relays, with the UI of
[soliloquy](https://github.com/skorokithakis/soliloquy). There is no backend:
each forum is a relay-based group, threads are `kind:11`
([NIP-7D](https://nips.nostr.com/7D)) and comments are `kind:1111`
([NIP-22](https://nips.nostr.com/22)), nested with lowercase `e` tags pointing at
the parent. Upvotes are `kind:7` reactions; un-voting deletes the reaction.

```sh
bun install
bun run dev      # or: bun run build
```

## routes

- `/`: your forums, from your `kind:10009` list (NIP-51)
- `/new`: create a forum on a NIP-29 relay (default `chat.wisp.talk`)
- `/naddr1…`: a forum (the naddr points at the group's `kind:39000`)
- `/naddr1…/<thread id>`, `/naddr1…/new`, `/naddr1…/search?q=`, `/naddr1…/settings`
- `/naddr1…?invite=<code>`: join a closed forum with an invite
- `/nevent1…`: a thread or comment with a relay hint; resolved through its `h` tag
  and redirected into its forum
- `/npub1…`: a profile; your own has your name, theme, keys and Google link
- `/notifications`: replies, comments on your threads and mentions

## how it works

- **Identity**: a key is made in the browser on first visit, with a random
  haiku name. The name (`kind:0`) and a relay list are published only on the
  first write. You can rename yourself, paste an nsec or a bunker URL, or link
  a Google account through [Pomegranate](https://github.com/fiatjaf/pomegranate),
  which splits the key across operators (`src/pomegranate.ts`, from hallway).
- **Storage**: every group event is kept in redstore (`@nostr/gadgets/redstore`).
  On startup each forum in your list syncs from the newest event the last
  complete sync brought, minus 2 hours. Then a live subscription keeps it up to
  date, and everything syncs again every 15 minutes (`src/sync.ts`).
- **Search** is local: a flexsearch index is built from the store on the first
  search, then new events from the live subscription are added to it.
- **Group admin**: name, about, picture, public/private and open/closed (as
  `kind:9002`, which resends the tags it doesn't edit, like subgroup links),
  members (`9000`/`9001`), invite links (`9009`), moderator deletions (`9005`).
- Unread dots and "new" comment marks are tracked per browser in localStorage,
  like soliloquy's thread reads.

Licensed AGPL-3.0, like soliloquy, whose stylesheet, fonts and icons this uses.
