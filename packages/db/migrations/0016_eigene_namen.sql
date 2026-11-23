-- 0016 Eigener Benutzername (ADR-082): Wer sein Konto sichert, tippt seinen Namen selbst. Dieser
-- eine Name ist Anmeldename und Spielername zugleich. Bezug: docs/DATA_MODEL.md §4.1,
-- docs/API.md §2.1, docs/GAME_RULES.md §3.9.
--
-- 1. Der Anmeldename darf jetzt auch einzelne Leerzeichen und lateinische Buchstaben mit
--    Akzent enthalten (á, ő, ł …). Die Datenbank prüft nur Zeichen und Länge (3–24, wie bisher);
--    die strengeren Regeln für neue Namen (3–20, Anfang und Ende Buchstabe oder Ziffer, keine
--    zwei Trennzeichen hintereinander, Wortfilter) prüft der Server. Bisherige Namen bleiben
--    gültig.
-- 2. Eigene Namen haben keine Bausteine: `player_profiles.name_parts` darf leer sein.
-- 3. Namensschlüssel: Zwei Namen, die sich nur in Groß- und Kleinschreibung, Akzenten oder den
--    Trennzeichen „ _.-“ unterscheiden („Krisz“, „krísz“, „K.risz“), gelten als derselbe Name.
--    Ein eindeutiger Index auf dem Schlüssel des Spielernamens verhindert Doppelgänger auch bei
--    gleichzeitigen Anfragen. Die bisherigen Namen aus Bausteinen sind auch im Schlüssel
--    verschieden (Integrationstest). Für Anmeldenamen gibt es nur einen einfachen Index für die
--    Prüfung „schon vergeben?“; eindeutig bleibt dort `users_username_unique` (citext).
--
-- Der Schlüssel macht aus İ und ı ein i, schreibt dann klein (lower), löst ß, æ, œ und ĳ auf und bildet dann Buchstaben
-- mit Akzent auf den Grundbuchstaben ab (translate). Großbuchstaben mit Akzent stehen ausdrücklich
-- in der Liste, damit der Schlüssel nicht vom Gebietsschema der Datenbank abhängt. Die
-- Trennzeichen am Ende der ersten Liste haben kein Gegenstück und fallen weg.

alter table users drop constraint users_username_format;
alter table users
  add constraint users_username_format
  check (username is null or username ~ '^[A-Za-z0-9 _.À-ÖØ-öø-ÿĀ-žȘ-ț-]{3,24}$');

alter table player_profiles alter column name_parts drop not null;

create function player_name_key(name text) returns text
  language sql
  immutable
  strict
  parallel safe
  return translate(
    replace(replace(replace(replace(replace(replace(replace(
      lower(replace(replace(name, 'İ', 'i'), 'ı', 'i')), 'ß', 'ss'), 'æ', 'ae'), 'Æ', 'ae'), 'œ', 'oe'), 'Œ', 'oe'), 'ĳ', 'ij'), 'Ĳ', 'ij'),
    'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞàáâãäåçèéêëìíîïðñòóôõöøùúûüýþÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįĴĵĶķĹĺĻļĽľĿŀŁłŃńŅņŇňŊŋŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžȘșȚț _.-',
    'aaaaaaceeeeiiiidnoooooouuuuytaaaaaaceeeeiiiidnoooooouuuuytyaaaaaaccccccccddddeeeeeeeeeegggggggghhhhiiiiiiiijjkkllllllllllnnnnnnnnoooooorrrrrrssssssssttttttuuuuuuuuuuuuwwyyyzzzzzzsstt'
  );

create unique index player_profiles_name_key_unique
  on player_profiles (player_name_key(display_name));
create index users_username_key on users (player_name_key(username::text))
  where username is not null;
