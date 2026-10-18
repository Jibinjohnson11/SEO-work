-- Fix: invited users could never complete their first sign-in. record_sign_in() moves the
-- caller's profile from 'invited' to 'active' (accepting the emailed invite proves ownership of
-- the address), but protect_profile() rejected every status change not made by an active Super
-- Admin — and an invited user is not active yet. This affected every invited intern and client
-- and the bootstrapped Super Admin.
--
-- protect_profile() now allows exactly one self-service change: the signed-in user moving their
-- OWN profile from 'invited' to 'active' with no other column changed. Every other rule is kept
-- as in 20261014000009_access_control.sql. Pending (self-registered), rejected and disabled users
-- still cannot change their own status.
create or replace function public.protect_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_trusted_backend() then
    return new;
  end if;

  if old.id = auth.uid() and old.status = 'invited' and new.status = 'active'
     and (to_jsonb(new) - 'status' - 'last_sign_in_at' - 'updated_at')
       = (to_jsonb(old) - 'status' - 'last_sign_in_at' - 'updated_at') then
    return new;
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email
     or new.created_by is distinct from old.created_by then
    raise exception 'Identity fields cannot be changed' using errcode = '42501';
  end if;

  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.permissions is distinct from old.permissions
     or new.daily_target is distinct from old.daily_target
     or new.weekly_target is distinct from old.weekly_target
     or new.monthly_target is distinct from old.monthly_target
     or new.joining_date is distinct from old.joining_date then
    if not public.is_super_admin() then
      raise exception 'Only a Super Admin can change role, status, permissions or targets' using errcode = '42501';
    end if;
    if new.role is distinct from old.role then
      if new.role = 'super_admin' then
        raise exception 'The Super Admin role can only be granted by a database administrator' using errcode = '42501';
      end if;
      if old.role = 'super_admin' then
        raise exception 'Super Admin accounts cannot be demoted from the application' using errcode = '42501';
      end if;
      if old.role is not null then
        raise exception 'A role is assigned once, when the account is approved' using errcode = '42501';
      end if;
    end if;
    if old.id = auth.uid() and new.status is distinct from 'active' then
      raise exception 'You cannot disable your own account' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
