create or replace function intake.reject_version_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'intake record versions are immutable';
  end if;
  if old.superseded_at is not null
     or new.superseded_at is null
     or new.intake_record_version_id is distinct from old.intake_record_version_id
     or new.student_id is distinct from old.student_id
     or new.workspace_id is distinct from old.workspace_id
     or new.version_number is distinct from old.version_number
     or new.school_configuration_release_id is distinct from old.school_configuration_release_id
     or new.intake_form_resource_id is distinct from old.intake_form_resource_id
     or new.intake_form_revision_number is distinct from old.intake_form_revision_number
     or new.submission_attestation_resource_id is distinct from old.submission_attestation_resource_id
     or new.submission_attestation_revision_number is distinct from old.submission_attestation_revision_number
     or new.locale is distinct from old.locale
     or new.wrapping_key_id is distinct from old.wrapping_key_id
     or new.wrapped_data_key is distinct from old.wrapped_data_key
     or new.ciphertext is distinct from old.ciphertext
     or new.accepted_at is distinct from old.accepted_at
     or new.record_owner is distinct from old.record_owner
     or new.record_classification is distinct from old.record_classification
     or new.disposal_class is distinct from old.disposal_class
  then
    raise exception 'intake record versions are immutable';
  end if;
  return new;
end;
$$;
