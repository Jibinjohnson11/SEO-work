-- Platform configuration defaults. This is configuration, not business data: every value
-- here is editable from Settings, and no clients, campaigns or submissions are created.

insert into public.roles (key, name, description) values
  ('super_admin', 'Super Admin', 'Platform owner with full control over every workspace and setting'),
  ('intern', 'Intern', 'Works assigned campaigns, submits backlink opportunities and content'),
  ('client', 'Client', 'Reviews and approves content and views reports for their own workspace')
on conflict (key) do nothing;

insert into public.backlink_types (name, slug, description, required_fields, review_checklist, sort_order) values
  ('Guest Posting', 'guest-posting', 'Original article placed on a relevant third-party site with editorial review.',
    '{content_title,content_draft,anchor_text}',
    '["Publisher is topically relevant", "Content is original and useful", "Anchor text is natural", "Link placement is editorial, not sitewide"]', 10),
  ('Business Directory', 'business-directory', 'Listing on a reputable, moderated business directory.',
    '{placement_url}',
    '["Directory is moderated and indexed", "NAP details match the client", "Category is correct"]', 20),
  ('Local Citation', 'local-citation', 'Name, address and phone citation on a local platform.',
    '{placement_url}',
    '["NAP details are consistent", "Platform is locally relevant"]', 30),
  ('Editorial Mention', 'editorial-mention', 'Earned mention within editorial content.',
    '{content_title,anchor_text}',
    '["Mention is editorially justified", "Publisher is relevant and reputable"]', 40),
  ('Resource Page', 'resource-page', 'Inclusion on a curated resource page.',
    '{placement_url,anchor_text}',
    '["Resource page is maintained", "Client resource genuinely fits the list"]', 50),
  ('Industry Directory', 'industry-directory', 'Listing on an industry- or specialty-specific directory.',
    '{placement_url}',
    '["Directory is specific to the client industry", "Listing details are accurate"]', 60),
  ('Profile Link', 'profile-link', 'Link from a genuine organisation or professional profile.',
    '{placement_url}',
    '["Profile is complete and legitimate", "Platform is relevant"]', 70),
  ('Digital PR', 'digital-pr', 'Coverage earned through newsworthy campaigns or expert commentary.',
    '{content_title,content_draft}',
    '["Story is newsworthy", "Claims are accurate and sourced"]', 80),
  ('Unlinked Brand Mention Outreach', 'unlinked-brand-mention', 'Request to link an existing unlinked brand mention.',
    '{placement_url,outreach_contact}',
    '["Mention exists on the page", "Outreach message is polite and specific"]', 90),
  ('Other', 'other', 'Any other legitimate placement type. Describe it in the submission notes.',
    '{}', '["Placement is legitimate and editorial"]', 100)
on conflict (slug) do nothing;

insert into public.application_settings (key, value) values
  ('general', jsonb_build_object(
    'platform_name', 'LinkOps', 'logo_url', null, 'default_timezone', 'Asia/Kolkata',
    'date_format', 'dd MMM yyyy', 'theme', 'system')),
  ('campaign_defaults', jsonb_build_object(
    'daily_target', 5, 'weekly_target', 25, 'monthly_target', 100, 'priority', 'medium',
    'priorities', jsonb_build_array('low', 'medium', 'high', 'urgent'))),
  ('approval', jsonb_build_object(
    'internal_review_required', true, 'client_approval_required', true, 'reapproval_on_material_change', true,
    'allow_admin_override', false, 'medical_review_required', true,
    'medical_checklist', jsonb_build_array(
      'Medical claims are accurate and current',
      'Claims are supported by cited, reputable sources',
      'No guarantees of outcomes or cures',
      'Content complies with applicable advertising rules for healthcare',
      'Reviewed by a qualified professional where required'),
    'notify_admins_on_submission', true, 'notify_client_on_forward', true)),
  ('verification', jsonb_build_object(
    'auto_verify', true, 'recheck_interval_hours', 72, 'timeout_ms', 10000, 'max_per_run', 25,
    'per_domain_delay_ms', 2000, 'respect_robots', true, 'max_redirects', 5, 'max_bytes', 2000000)),
  ('reports', jsonb_build_object(
    'schedule', 'off', 'recipients', jsonb_build_array(), 'format', 'xlsx', 'timezone', 'Asia/Kolkata')),
  ('notifications', jsonb_build_object('email_enabled', false, 'deadline_warning_days', 2)),
  ('security', jsonb_build_object('idle_timeout_minutes', 0, 'log_sign_ins', true))
on conflict (key) do nothing;
