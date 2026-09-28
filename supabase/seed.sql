-- Seed members: the three prototype personas plus synthetic members, so every
-- desk has someone and every approver path can be reached (Story 1.3).
--
-- `supabase db reset` runs this locally after the migrations.
-- scripts/staging-personas.mjs runs it on staging after creating the
-- personas with the staging password.
--
-- It creates auth users only. The `on_auth_user_created` trigger makes each
-- a pending member; this file then sets the name and upserts the positions,
-- keyed by email, which sets the role. It never inserts into `members`
-- (AD-17). Running it again changes nothing:
--
-- - An auth user whose email already exists is skipped (`on conflict do
--   nothing`), so on staging the personas keep the password the script gave
--   them, and the local persona password below never reaches staging.
-- - Personas get the local persona password (the `PROTOTYPE_PERSONA_PASSWORD`
--   value in .env.example). Everyone else gets no password and can't sign in.
-- - The first position listed is the primary one.
--
-- The persona emails and names must match src/features/members/personas.ts
-- (src/features/members/members-data.test.ts checks).

do $$
declare
  seed record;
  v_member_id uuid;
begin
  for seed in
    select *
    from (
      values
        -- Personas
        ('persona-staff_layout_artist@example.com', 'Staff Layout Artist', true, array['staff_layout_artist']),
        ('persona-head_layout_artist@example.com', 'Head Layout Artist', true, array['head_layout_artist']),
        ('persona-editor_in_chief@example.com', 'Editor-in-Chief', true, array['editor_in_chief']),
        -- Staff, and the Head of each other desk
        ('demo-staff_writer@example.com', 'Staff Writer', false, array['staff_writer']),
        ('demo-staff_cartoonist@example.com', 'Staff Cartoonist', false, array['staff_cartoonist']),
        ('demo-head_cartoonist@example.com', 'Head Cartoonist', false, array['head_cartoonist']),
        ('demo-staff_photojournalist@example.com', 'Staff Photojournalist', false, array['staff_photojournalist']),
        ('demo-head_photojournalist@example.com', 'Head Photojournalist', false, array['head_photojournalist']),
        ('demo-staff_videojournalist@example.com', 'Staff Videojournalist', false, array['staff_videojournalist']),
        ('demo-head_videojournalist@example.com', 'Head Videojournalist', false, array['head_videojournalist']),
        ('demo-staff_broadcast_journalist@example.com', 'Staff Broadcast Journalist', false, array['staff_broadcast_journalist']),
        ('demo-head_broadcast_journalist@example.com', 'Head Broadcast Journalist', false, array['head_broadcast_journalist']),
        -- Section Editors, one of them also the Online Manager
        ('demo-sports_editor@example.com', 'Sports Editor', false, array['sports_editor']),
        ('demo-news_editor@example.com', 'News Editor and Online Manager', false, array['news_editor', 'online_manager']),
        -- The other top editors and management
        ('demo-associate_editor@example.com', 'Associate Editor', false, array['associate_editor']),
        ('demo-managing_editor@example.com', 'Managing Editor', false, array['managing_editor']),
        ('demo-finance_manager@example.com', 'Finance Manager', false, array['finance_manager'])
    ) as s (email, name, is_persona, positions)
  loop
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      seed.email,
      case
        when seed.is_persona
          then extensions.crypt('local-persona-password', extensions.gen_salt('bf'))
        else ''
      end,
      now(),
      '{"provider": "email", "providers": ["email"]}',
      jsonb_build_object('full_name', seed.name),
      now(),
      now(),
      '',
      '',
      '',
      ''
    )
    on conflict do nothing;

    select m.id into v_member_id
    from public.members m
    where m.email = seed.email;

    if v_member_id is null then
      raise exception 'seed.sql: no member row for %', seed.email;
    end if;

    update public.members m
    set name = seed.name,
        updated_at = now()
    where m.id = v_member_id
      and m.name is distinct from seed.name;

    insert into public.member_positions (member_id, position, is_primary)
    select v_member_id, p.position, p.ordinality = 1
    from unnest(seed.positions) with ordinality as p (position, ordinality)
    on conflict (member_id, position) do update
      set is_primary = excluded.is_primary
      where member_positions.is_primary is distinct from excluded.is_primary;
  end loop;
end
$$;
