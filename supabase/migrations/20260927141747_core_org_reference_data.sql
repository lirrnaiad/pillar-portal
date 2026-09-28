-- core_org_reference_data: the rows of sections, desks and positions
-- (AD-17: reference data ships as idempotent migrations).
--
-- Each statement upserts by id, so running this file again restores a
-- deleted row and resets an edited one without duplicating anything.
-- supabase/tests/core/org_reference.test.sql re-executes the statements the
-- CLI recorded for this migration to prove it. Keep this file to DML with no
-- `begin` or `commit`, which can't be re-executed that way. Changing a row
-- later means a new migration, not an edit here.

insert into public.sections (id, name, sort_order) values
  ('news', 'News', 1),
  ('sports', 'Sports', 2),
  ('feature', 'Feature', 3),
  ('scitech', 'Sci-Tech', 4),
  ('culture', 'Culture', 5),
  ('opinion', 'Opinion', 6),
  ('editorial', 'Editorial', 7)
on conflict (id) do update set
  name = excluded.name,
  sort_order = excluded.sort_order;

insert into public.desks (id, name, production_role, sort_order) values
  ('writers', 'Writers', 'writer', 1),
  ('layout', 'Layout', 'layout_artist', 2),
  ('cartoons', 'Cartoons', 'cartoonist', 3),
  ('photo', 'Photo', 'photojournalist', 4),
  ('video', 'Video', 'videojournalist', 5),
  ('broadcast', 'Broadcast', 'broadcast_journalist', 6)
on conflict (id) do update set
  name = excluded.name,
  production_role = excluded.production_role,
  sort_order = excluded.sort_order;

-- Staff: one per desk, report title without "Staff", heads nothing, not on
-- the Board. Heads: head their own desk. Section Editors: on the Writers
-- desk, each heading its content section. Top editors and management: no
-- desk.
insert into public.positions (
  id, title, report_title, desk_id, heads_desk_id, heads_section_id,
  is_top_editor, is_board, sort_order
) values
  ('staff_writer', 'Staff Writer', 'Writer', 'writers', null, null, false, false, 1),
  ('staff_layout_artist', 'Staff Layout Artist', 'Layout Artist', 'layout', null, null, false, false, 2),
  ('staff_cartoonist', 'Staff Cartoonist', 'Cartoonist', 'cartoons', null, null, false, false, 3),
  ('staff_photojournalist', 'Staff Photojournalist', 'Photojournalist', 'photo', null, null, false, false, 4),
  ('staff_videojournalist', 'Staff Videojournalist', 'Videojournalist', 'video', null, null, false, false, 5),
  ('staff_broadcast_journalist', 'Staff Broadcast Journalist', 'Broadcast Journalist', 'broadcast', null, null, false, false, 6),
  ('head_layout_artist', 'Head Layout Artist', 'Head Layout Artist', 'layout', 'layout', null, false, true, 7),
  ('head_cartoonist', 'Head Cartoonist', 'Head Cartoonist', 'cartoons', 'cartoons', null, false, true, 8),
  ('head_photojournalist', 'Head Photojournalist', 'Head Photojournalist', 'photo', 'photo', null, false, true, 9),
  ('head_videojournalist', 'Head Videojournalist', 'Head Videojournalist', 'video', 'video', null, false, true, 10),
  ('head_broadcast_journalist', 'Head Broadcast Journalist', 'Head Broadcast Journalist', 'broadcast', 'broadcast', null, false, true, 11),
  ('news_editor', 'News Editor', 'News Editor', 'writers', null, 'news', false, true, 12),
  ('sports_editor', 'Sports Editor', 'Sports Editor', 'writers', null, 'sports', false, true, 13),
  ('feature_editor', 'Feature Editor', 'Feature Editor', 'writers', null, 'feature', false, true, 14),
  ('scitech_editor', 'Sci-Tech Editor', 'Sci-Tech Editor', 'writers', null, 'scitech', false, true, 15),
  ('culture_editor', 'Culture Editor', 'Culture Editor', 'writers', null, 'culture', false, true, 16),
  ('editor_in_chief', 'Editor-in-Chief', 'Editor-in-Chief', null, null, null, true, true, 17),
  ('associate_editor', 'Associate Editor', 'Associate Editor', null, null, null, true, true, 18),
  ('managing_editor', 'Managing Editor', 'Managing Editor', null, null, null, true, true, 19),
  ('finance_manager', 'Finance Manager', 'Finance Manager', null, null, null, false, true, 20),
  ('assistant_finance_manager', 'Assistant Finance Manager', 'Assistant Finance Manager', null, null, null, false, true, 21),
  ('online_manager', 'Online Manager', 'Online Manager', null, null, null, false, true, 22)
on conflict (id) do update set
  title = excluded.title,
  report_title = excluded.report_title,
  desk_id = excluded.desk_id,
  heads_desk_id = excluded.heads_desk_id,
  heads_section_id = excluded.heads_section_id,
  is_top_editor = excluded.is_top_editor,
  is_board = excluded.is_board,
  sort_order = excluded.sort_order;
