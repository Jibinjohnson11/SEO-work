-- Self-registration: accounts created from the sign-up page start as 'pending' and stay without
-- any data access until a Super Admin approves them (-> 'active') or rejects them (-> 'rejected').
-- Kept in its own migration: a new enum value cannot be used in the transaction that adds it.
alter type public.user_status add value if not exists 'pending';
alter type public.user_status add value if not exists 'rejected';
