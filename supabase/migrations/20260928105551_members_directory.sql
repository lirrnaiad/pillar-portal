-- members_directory: the one way active members read each other (AD-19).
--
-- `member_directory` is the exception to "every view is security_invoker"
-- (supabase/tests/00_security/catalog.test.sql carries it by name): it runs
-- with its owner's rights, so it can list every active member regardless of
-- the caller's own `members_select_self_or_admin` policy, while never
-- exposing an email address. `security_barrier` stops the planner from
-- pushing a caller-supplied qualification (e.g. from a `where` on a query
-- against this view) ahead of the view's own row selection.
--
-- Each row is one active member, with their positions as a JSON array
-- ordered primary first, each carrying its desk (or null for top editors and
-- management) so a slot picker can find "who's on the Layout desk" without a
-- second round trip through `members`/`member_positions`, which this view's
-- caller can't read directly.

create view public.member_directory
  with (security_barrier = true) as
select
  m.id,
  m.name,
  m.avatar_url,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'position', mp.position,
        'is_primary', mp.is_primary,
        'desk_id', p.desk_id
      )
      order by mp.is_primary desc, mp.position
    ) filter (where mp.position is not null),
    '[]'::jsonb
  ) as positions
from public.members m
left join public.member_positions mp on mp.member_id = m.id
left join public.positions p on p.id = mp.position
where m.role <> 'pending'
group by m.id, m.name, m.avatar_url;

grant select on public.member_directory to authenticated;
