create table if not exists user_branches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, branch_id)
);

insert into user_branches(user_id, branch_id)
select u.id, u.branch_id
from users u
where u.branch_id is not null
on conflict (user_id, branch_id) do nothing;

create index if not exists idx_user_branches_user on user_branches(user_id);
create index if not exists idx_user_branches_branch on user_branches(branch_id);
