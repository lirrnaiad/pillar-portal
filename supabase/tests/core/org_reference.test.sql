-- Org reference data (AD-5, AD-17): sections, desks and positions hold the
-- spine's rows, and core_org_reference_data is idempotent.
--
-- The idempotence check re-executes the statements the CLI recorded for that
-- migration in supabase_migrations.schema_migrations, twice, after deleting
-- and editing rows, and expects the tables to match a snapshot taken before.
-- Everything is rolled back.

begin;

select plan(24);

-- Counts.

select results_eq(
  $$ select count(*)::int from public.sections $$,
  array[7],
  '7 sections'
);

select results_eq(
  $$ select count(*)::int from public.desks $$,
  array[6],
  '6 desks'
);

select results_eq(
  $$ select count(*)::int from public.positions $$,
  array[22],
  '22 positions'
);

-- Sections and desks.

select results_eq(
  $$ select id, name from public.sections order by sort_order $$,
  $$ values ('news', 'News'), ('sports', 'Sports'), ('feature', 'Feature'),
            ('scitech', 'Sci-Tech'), ('culture', 'Culture'),
            ('opinion', 'Opinion'), ('editorial', 'Editorial') $$,
  'the sections, in order'
);

select set_eq(
  $$ select id, name, production_role::text from public.desks $$,
  $$ values ('writers', 'Writers', 'writer'),
            ('layout', 'Layout', 'layout_artist'),
            ('cartoons', 'Cartoons', 'cartoonist'),
            ('photo', 'Photo', 'photojournalist'),
            ('video', 'Video', 'videojournalist'),
            ('broadcast', 'Broadcast', 'broadcast_journalist') $$,
  'each desk does one production role'
);

select set_eq(
  $$ select production_role::text from public.desks $$,
  $$ select unnest(enum_range(null::public.production_role))::text $$,
  'every production role has a desk'
);

-- Positions.

select is_empty(
  $$ select id from public.positions
     where heads_section_id in ('opinion', 'editorial') $$,
  'no position heads Opinion or Editorial'
);

select set_eq(
  $$ select heads_section_id, id from public.positions
     where heads_section_id is not null $$,
  $$ values ('news', 'news_editor'), ('sports', 'sports_editor'),
            ('feature', 'feature_editor'), ('scitech', 'scitech_editor'),
            ('culture', 'culture_editor') $$,
  'each other section has one Section Editor'
);

select is_empty(
  $$ select id from public.positions
     where heads_section_id is not null and desk_id is distinct from 'writers' $$,
  'Section Editors are on the Writers desk'
);

select set_eq(
  $$ select heads_desk_id, id from public.positions
     where heads_desk_id is not null $$,
  $$ values ('layout', 'head_layout_artist'),
            ('cartoons', 'head_cartoonist'),
            ('photo', 'head_photojournalist'),
            ('video', 'head_videojournalist'),
            ('broadcast', 'head_broadcast_journalist') $$,
  'every desk but Writers has one Head'
);

select is_empty(
  $$ select id from public.positions
     where heads_desk_id is not null and desk_id is distinct from heads_desk_id $$,
  'a Head belongs to the desk they head'
);

select set_eq(
  $$ select id from public.positions where is_top_editor $$,
  $$ values ('editor_in_chief'), ('associate_editor'), ('managing_editor') $$,
  '3 top editors'
);

select results_eq(
  $$ select count(*)::int from public.positions where is_board $$,
  array[16],
  '16 Board positions'
);

select set_eq(
  $$ select id, title, report_title, desk_id from public.positions
     where not is_board $$,
  $$ values
       ('staff_writer', 'Staff Writer', 'Writer', 'writers'),
       ('staff_layout_artist', 'Staff Layout Artist', 'Layout Artist', 'layout'),
       ('staff_cartoonist', 'Staff Cartoonist', 'Cartoonist', 'cartoons'),
       ('staff_photojournalist', 'Staff Photojournalist', 'Photojournalist', 'photo'),
       ('staff_videojournalist', 'Staff Videojournalist', 'Videojournalist', 'video'),
       ('staff_broadcast_journalist', 'Staff Broadcast Journalist', 'Broadcast Journalist', 'broadcast') $$,
  'the 6 Staff positions, one per desk, with report titles that drop "Staff"'
);

select is_empty(
  $$ select id from public.positions
     where not is_board
       and (heads_desk_id is not null or heads_section_id is not null) $$,
  'Staff positions head nothing'
);

select is_empty(
  $$ select id from public.positions
     where is_board and report_title <> title $$,
  'Board positions keep their title as the report title'
);

select set_eq(
  $$ select id from public.positions where desk_id is null $$,
  $$ values ('editor_in_chief'), ('associate_editor'), ('managing_editor'),
            ('finance_manager'), ('assistant_finance_manager'),
            ('online_manager') $$,
  'top editors and management have no desk'
);

select results_eq(
  $$ select title from public.positions where id = 'scitech_editor' $$,
  array['Sci-Tech Editor'],
  'the Sci-Tech Editor title'
);

-- Constraints.

select throws_ok(
  $$ insert into public.sections (id, name, sort_order)
     values ('Not A Slug', 'Bad', 99) $$,
  '23514',
  null,
  'a section id must be a slug'
);

select throws_ok(
  $$ insert into public.positions (id, title, report_title, heads_desk_id,
                                   heads_section_id, is_board, sort_order)
     values ('two_heads', 'Two Heads', 'Two Heads', 'layout', 'news', true, 99) $$,
  '23514',
  null,
  'a position heads at most one desk or section'
);

select throws_ok(
  $$ insert into public.positions (id, title, report_title, is_top_editor,
                                   is_board, sort_order)
     values ('top_not_board', 'Top Not Board', 'Top Not Board', true, false, 99) $$,
  '23514',
  null,
  'a top editor is a Board position'
);

-- Idempotence: snapshot, tamper, re-execute the recorded statements twice.

create temp table sections_before as select * from public.sections;
create temp table desks_before as select * from public.desks;
create temp table positions_before as select * from public.positions;

delete from public.sections where id = 'opinion';
update public.sections set name = 'Tampered', sort_order = 99 where id = 'news';
update public.desks set name = 'Tampered' where id = 'photo';
delete from public.positions where id = 'assistant_finance_manager';
update public.positions
set title = 'Tampered', is_board = false, heads_section_id = null
where id = 'sports_editor';

do $$
declare
  v_statement text;
  v_found boolean := false;
begin
  reset role;
  for i in 1..2 loop
    for v_statement in
      select unnest(m.statements)
      from supabase_migrations.schema_migrations m
      where m.name = 'core_org_reference_data'
    loop
      v_found := true;
      execute v_statement;
    end loop;
  end loop;
  if not v_found then
    raise exception 'core_org_reference_data is not recorded in supabase_migrations.schema_migrations';
  end if;
end
$$;

select bag_eq(
  $$ select * from public.sections $$,
  $$ select * from sections_before $$,
  'the re-run restores every section, each exactly once'
);

select bag_eq(
  $$ select * from public.desks $$,
  $$ select * from desks_before $$,
  'the re-run restores every desk, each exactly once'
);

select bag_eq(
  $$ select * from public.positions $$,
  $$ select * from positions_before $$,
  'the re-run restores every position, each exactly once'
);

select * from finish();

rollback;
