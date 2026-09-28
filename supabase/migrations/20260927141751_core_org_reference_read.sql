-- core_org_reference_read: active members read sections, desks and positions
-- (AD-5). A pending caller reads none of them. This comes after
-- members_members because the policies call `private.is_active_member()`.

create policy sections_select_active
  on public.sections
  for select
  to authenticated
  using ((select private.is_active_member()));

create policy desks_select_active
  on public.desks
  for select
  to authenticated
  using ((select private.is_active_member()));

create policy positions_select_active
  on public.positions
  for select
  to authenticated
  using ((select private.is_active_member()));
