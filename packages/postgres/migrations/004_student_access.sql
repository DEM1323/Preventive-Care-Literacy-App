alter table identity_access.invitations
  add column authorization_expires_at timestamptz
  default (transaction_timestamp() + interval '7 days');

update identity_access.invitations invitation
   set authorization_expires_at = challenge.expires_at
  from identity_access.invitation_challenges challenge
 where challenge.invitation_id = invitation.invitation_id
   and challenge.generation = invitation.current_generation;

alter table identity_access.invitations
  alter column authorization_expires_at set not null;

alter table identity_access.invitations
  drop constraint invitations_status_check;
alter table identity_access.invitations
  add constraint invitations_status_check
  check (status in (
    'pending_delivery', 'delivered', 'delivery_failed', 'expired',
    'completed', 'revoked', 'superseded'
  ));

alter table identity_access.invitation_challenges
  add column failed_attempts integer not null default 0
  check (failed_attempts between 0 and 5);

alter table identity_access.invitation_challenges
  add column lookup_digest text;

create index invitation_challenges_lookup_digest_idx
  on identity_access.invitation_challenges(lookup_digest)
  where lookup_digest is not null;

create index invitations_recipient_digest_idx
  on identity_access.invitations(recipient_digest, created_at desc);

create table identity_access.students (
  student_id uuid primary key,
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  status text not null check (status in ('active', 'disabled')),
  created_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'student_identity'),
  unique (student_id, workspace_id)
);

create table identity_access.verified_email_addresses (
  verified_email_address_id uuid primary key,
  workspace_id uuid not null,
  student_id uuid not null,
  recipient_digest text not null,
  key_id text not null,
  ciphertext text not null,
  status text not null check (status in ('current', 'historical')),
  verified_at timestamptz not null,
  retired_at timestamptz,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'verified_email_address'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  unique (workspace_id, recipient_digest)
);

create unique index verified_email_addresses_one_current_idx
  on identity_access.verified_email_addresses(workspace_id, student_id)
  where status = 'current';

create table identity_access.class_memberships (
  class_membership_id uuid primary key,
  workspace_id uuid not null,
  student_id uuid not null,
  class_id uuid not null,
  status text not null check (status in ('active', 'inactive')),
  activated_at timestamptz not null,
  deactivated_at timestamptz,
  created_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'class_membership'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  foreign key (class_id, workspace_id)
    references identity_access.classes(class_id, workspace_id),
  unique (student_id, class_id)
);

create table identity_access.student_sessions (
  session_id uuid primary key,
  workspace_id uuid not null,
  student_id uuid not null,
  session_handle_hash text not null unique,
  authenticated_at timestamptz not null,
  last_seen_at timestamptz not null,
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'student_session'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id)
);

alter table identity_access.students enable row level security;
alter table identity_access.verified_email_addresses enable row level security;
alter table identity_access.class_memberships enable row level security;
alter table identity_access.student_sessions enable row level security;
alter table identity_access.students force row level security;
alter table identity_access.verified_email_addresses force row level security;
alter table identity_access.class_memberships force row level security;
alter table identity_access.student_sessions force row level security;

create policy invitations_redemption_scope on identity_access.invitations
  using (recipient_digest = nullif(current_setting('app.invitation_recipient_digest', true), ''));

create policy classes_student_scope on identity_access.classes
  using (exists (
    select 1 from identity_access.class_memberships membership
     where membership.class_id = classes.class_id
       and membership.student_id = nullif(current_setting('app.student_id', true), '')::uuid
       and membership.status = 'active'
  ));

create policy students_scope on identity_access.students
  using (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy verified_email_addresses_scope on identity_access.verified_email_addresses
  using (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    or recipient_digest = nullif(current_setting('app.invitation_recipient_digest', true), '')
  )
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy class_memberships_scope on identity_access.class_memberships
  using (student_id = nullif(current_setting('app.student_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy student_sessions_handle_scope on identity_access.student_sessions
  using (session_handle_hash = nullif(current_setting('app.student_session_handle_hash', true), ''))
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and session_handle_hash = nullif(current_setting('app.student_session_handle_hash', true), '')
  );
