-- 0008 Version des Kartengenerators je Instanz. Bezug: docs/WORLD_SYSTEM.md §3.2,
-- packages/game-core (MAPGEN_VERSION). Spätere Ringe (§4.1) müssen mit derselben Version erzeugt
-- werden wie der Kern, sonst passen die Chunks nicht zusammen. Ohne Standardwert: Wer eine
-- Instanz anlegt, nennt die Version ausdrücklich. Bisher gibt es keine Instanzen (keine Welt
-- wurde vor Paket 2 angelegt), daher kein Rückfüllen.
alter table world_instances
  add column mapgen_version smallint not null check (mapgen_version >= 1);
