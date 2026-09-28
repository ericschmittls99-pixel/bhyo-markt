-- Ausgefuehrt am 28.09.2026 von Eric im Neon SQL Editor, Branch production, nach Block B.
-- Ergebnis: last_value 1 | is_called false.

-- Block C: Belegnummer zuruecksetzen. Nur nach erfolgreichem Block B.
do $$
begin
  if exists (select 1 from beleg) then
    raise exception 'beleg ist nicht leer. Abbruch.';
  end if;
  perform setval('beleg_nr_seq', 1, false);
end $$;

select last_value, is_called from beleg_nr_seq;
-- erwartet: 1 | false
