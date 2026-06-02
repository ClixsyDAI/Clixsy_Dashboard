-- =============================================================
-- 014_pr_d_2_add_user_by_email.sql
-- =============================================================
--
-- PR D-2: add a pure add-by-email path for super_admins so they can
-- pre-allowlist users without first issuing an invite or waiting for
-- an access request. The corresponding UI in /admin (Users tab)
-- consumes this RPC.
--
-- This RPC is structurally identical to approve_access_request from
-- migration 013, except:
--   1. There is no access_request lookup; the actor supplies the
--      target email directly.
--   2. The target email is lowercased + trimmed at entry to avoid
--      the case-sensitivity duplicate-row footgun.
--   3. The audit event is 'user_added_via_allowlist'.
--
-- Caller authorization: the HTTP route layer (withAdminAuth +
-- requireRole minRole=super_admin) is the primary gate. This RPC
-- ALSO enforces actor_session_stale via pr_d1_check_actor_session,
-- same as the other 8 mutation RPCs.
--
-- Errors are returned as jsonb sentinels (no raise-exception) to
-- preserve the audit row in the same transaction.

create or replace function public.add_user_by_email(
  p_target_email text,
  p_role text,
  p_actor_email text,
  p_actor_session_version int,
  p_request_metadata jsonb
) returns jsonb
  language plpgsql
  security definer
as $$
declare
  v_normalized_email text;
  v_payload jsonb;
begin
  -- 1. Actor session TOCTOU guard (mirrors 013:342).
  if not public.pr_d1_check_actor_session(p_actor_email, p_actor_session_version) then
    v_payload := jsonb_build_object(
      'rpc', 'add_user_by_email',
      'reason', 'actor_session_stale',
      'target_email', p_target_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'actor_session_stale');
  end if;

  -- 2. Normalize the target email (lower + trim). Prevents the
  --    case-sensitivity duplicate-row hazard called out in the
  --    PR D-2 schema review.
  v_normalized_email := lower(trim(p_target_email));

  -- 3. Validate role against the closed enum.
  if p_role not in ('super_admin', 'admin', 'viewer') then
    v_payload := jsonb_build_object(
      'rpc', 'add_user_by_email',
      'reason', 'invalid_role',
      'attempted_role', p_role,
      'target_email', v_normalized_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 400, 'reason', 'invalid_role');
  end if;

  -- 4. Basic shape check: must be non-empty and contain @.
  if v_normalized_email = '' or position('@' in v_normalized_email) = 0 then
    v_payload := jsonb_build_object(
      'rpc', 'add_user_by_email',
      'reason', 'invalid_email',
      'target_email', v_normalized_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 400, 'reason', 'invalid_email');
  end if;

  -- 5. INSERT the new app_users row. unique_violation -> email
  --    already in app_users (also covers concurrent add races).
  begin
    insert into public.app_users (email, role, added_by, added_at)
      values (v_normalized_email, p_role, p_actor_email, now());
  exception when unique_violation then
    v_payload := jsonb_build_object(
      'rpc', 'add_user_by_email',
      'reason', 'email_already_in_users',
      'target_email', v_normalized_email,
      'request_metadata', p_request_metadata
    );
    perform public.pr_d1_write_audit_event('users_action_rejected', p_actor_email, v_payload);
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'email_already_in_users');
  end;

  -- 6. Success audit.
  v_payload := jsonb_build_object(
    'target_email', v_normalized_email,
    'target_role', p_role,
    'added_by_email', p_actor_email,
    'request_metadata', p_request_metadata
  );
  perform public.pr_d1_write_audit_event('user_added_via_allowlist', p_actor_email, v_payload);

  return jsonb_build_object('ok', true, 'email', v_normalized_email, 'role', p_role);
end;
$$;

grant execute on function public.add_user_by_email(text, text, text, int, jsonb) to service_role;
revoke execute on function public.add_user_by_email(text, text, text, int, jsonb) from anon, authenticated;
