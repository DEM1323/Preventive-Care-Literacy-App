alter table intake.intake_drafts
  add column draft_revision integer not null default 1
    check (draft_revision > 0);

alter table intake.intake_drafts
  alter column draft_revision drop default;
