# Item icons

One 32px PNG per item, named for its item id. `sulwood.png`, `crude_talamite.png`,
`swallow_feather.png`, and so on — the ids are the keys in
`src/economy/items.ts`.

Drop a file in and it appears; nothing registers it and nothing needs rebuilding.
An item with no file falls back to `_missing.png`, the magenta checkerboard, which
is deliberately not a palette colour: its whole job is to look wrong so an
unmade asset is noticed rather than lived with.

32x32, to match the world's tile size, so an icon in a slot and the same thing
lying on the ground are the same drawing at the same scale. A chest slot is 36px
with a 2px border, so the art sits in a 32px box at exactly 1:1 and is never
resampled — the panel's width is derived from that, not chosen.

The wanted list, and the props that go through the Asset Library instead, are in
`docs/interface-art.md` under "The drawing queue".
