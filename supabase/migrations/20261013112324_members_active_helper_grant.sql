-- members_active_helper_grant: lets `member_directory` run for its callers
-- again (a fix to Story 1.13's members_active_helper).
--
-- A view reads tables with its owner's rights but checks EXECUTE on the
-- functions it calls against the querying role. Story 1.13 granted
-- `private.is_member_active` to nobody, so every `authenticated` read of
-- `member_directory` failed with "permission denied for function
-- is_member_active". `private` isn't exposed through the Data API, so this
-- doesn't make the helper callable as an RPC; it is granted like the other
-- helpers that policies and views call.

grant execute on function private.is_member_active(uuid) to authenticated;
