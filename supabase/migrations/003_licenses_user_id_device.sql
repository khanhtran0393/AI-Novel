-- licenses.user_id = mã thiết bị (HWID) của app user (desktop)
-- Trước: uuid FK → profiles (auth). App desktop không bắt login Supabase Auth.
-- Sau: text = HWID (cùng giá trị chuẩn hóa với cột hwid).

alter table public.licenses
  drop constraint if exists licenses_user_id_fkey;

-- uuid → text (giữ giá trị cũ nếu có; row desktop null sẽ backfill từ hwid)
alter table public.licenses
  alter column user_id type text using (
    case
      when user_id is null then null
      else user_id::text
    end
  );

-- Backfill: user_id trống → lấy hwid (mã máy)
update public.licenses
set user_id = lower(trim(hwid))
where user_id is null
  and hwid is not null
  and length(trim(hwid)) >= 6;

comment on column public.licenses.user_id is
  'Device identity for desktop: HWID (same as hwid). Not auth.users uuid.';

create index if not exists licenses_user_id_text_idx on public.licenses (user_id);
