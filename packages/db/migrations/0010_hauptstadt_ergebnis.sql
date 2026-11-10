-- 0010 Hauptstadt-Wirkung im Kampfergebnis vollständig und eindeutig (Review zu 0009, ADR-037).
-- Bezug: docs/DATA_MODEL.md §4, docs/API.md (Auflösung `capital`).
--
-- 1. Der Schutz, den ein Treffer der Hauptstadt gibt, wird mit dem Ergebnis gespeichert. Die
--    Auflösung zeigte bisher den aktuellen Schutz der Region; nach einem späteren Treffer wäre das
--    nicht mehr der Schutz dieses Kampfs.
-- 2. Die Prüfung erlaubt nur noch die drei gültigen Fälle: keine Hauptstadt (alles leer), Treffer
--    (Leben übrig, nichts übernommen) und Übernahme (kein Leben übrig, Regionen übernommen, kein
--    Schutz). 0009 ließ z. B. eine Übernahme ohne Regionenzahl zu.
-- Bestehende Zeilen erfüllen die neue Prüfung: Treffer vor dieser Migration haben nur keinen
-- gespeicherten Schutz. Die Vergleiche stehen hinter `is not null`, weil eine Prüfung mit dem
-- Ergebnis NULL als bestanden gilt.
alter table battle_results
  add column capital_protected_until timestamptz null,
  drop constraint battle_results_capital_effect,
  add constraint battle_results_capital_effect check (
    (capital_lives_left is null and regions_taken is null and capital_protected_until is null)
    or (capital_lives_left is not null and capital_lives_left > 0 and regions_taken is null)
    or (capital_lives_left is not null and capital_lives_left = 0
        and regions_taken is not null and capital_protected_until is null)
  );
