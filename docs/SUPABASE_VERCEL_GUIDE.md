# Quản lý user & bảo mật với Supabase + Vercel

App AI Novel hiện là **desktop local-first** (Electron + license HMAC/HWID).  
Supabase + Vercel dùng làm **cổng cloud**: tài khoản, đơn hàng, cấp key, không nhét secret vào máy khách.

## Đã tích hợp trong repo (2026-07)

| Thành phần | Path |
|------------|------|
| SQL + RLS | `supabase/migrations/001_commercial_rls.sql` |
| Env helpers | `src/lib/supabase/env.ts` |
| Server clients | `src/lib/supabase/server.ts` (anon JWT + **service_role**) |
| Browser client | `src/lib/supabase/browser.ts` |
| License bridge | `src/lib/cloud/licenseBridge.ts` (HMAC + orders + trial + revoke) |
| API cloud | `/api/cloud/*` (status, orders, confirm, issue, verify, trial, revoke) |
| Admin UI | `/admin` (admin key + list orders + confirm) |
| Desktop client | `src/app/workspace/modules/cloudClient.ts` |
| License modal | Ưu tiên cloud trial; hiện trạng Supabase |

### API nhanh

| Method | Path | Ai gọi |
|--------|------|--------|
| GET | `/api/cloud/status` | Public |
| POST | `/api/cloud/orders` | App (tạo pending) |
| GET | `/api/cloud/orders` | Admin key / admin JWT |
| POST | `/api/cloud/orders/confirm` | Admin |
| POST | `/api/cloud/license/issue` | Admin |
| POST | `/api/cloud/license/verify` | App heartbeat |
| POST | `/api/cloud/license/trial` | App |
| POST | `/api/cloud/license/revoke` | Admin |

**Hybrid:** chưa set Supabase → mọi thứ vẫn chạy **local** (Zalo + HMAC).

---

## 1. Vai trò từng lớp (đừng nhầm)

| Lớp | Công nghệ | Làm gì | Không làm gì |
|-----|-----------|--------|--------------|
| **App desktop** | Electron (repo này) | Viết truyện, media, TTS, đọc license local | Không giữ service_role; không tin client |
| **Backend API** | **Vercel** (Next.js Route Handlers) | Login session, webhook CK, issue license, revoke | Không expose DB password ra browser |
| **Database + Auth** | **Supabase** | User, profile, orders, licenses, audit log | Không để anon key ghi bừa bảng nhạy cảm |
| **Storage (tuỳ)** | Supabase Storage | Bill ảnh, export pack (optional) | Không public bucket chứa |

```
Khách (Desktop)
    │  HTTPS + JWT (Supabase session) hoặc device HWID + license token
    ▼
Vercel API  ──service_role──►  Supabase (Postgres + Auth + RLS)
    │
    └── issue HMAC license (SECRET chỉ trên Vercel env)
          ▼
     App desktop lưu token local (như hiện tại)
```

**Nguyên tắc thép:**  
`AINOVEL_ENTITLEMENT_SECRET` và `SUPABASE_SERVICE_ROLE_KEY` **chỉ** nằm trên **Vercel env** (hoặc máy seller).  
App Electron / browser **không bao giờ** nhận 2 key này.

---

## 2. Mô hình sản phẩm (gắn code hiện tại)

| Gói app | Cloud (Supabase) | Desktop |
|---------|------------------|---------|
| Free | Có thể anonymous / account free | Không token Pro |
| Trial 3 ngày | `licenses` row plan=trial | `assertProAccess` + trial vault **hoặc** token trial từ server |
| Pro tháng/năm/trọn đời | `orders` paid → `licenses` active | Token HMAC HWID-bound (như `issueEntitlementToken`) |

**Khuyến nghị:**  
- Cloud = nguồn chân lý **ai được phép Pro**.  
- Desktop vẫn verify HMAC local (offline grace) + thỉnh thoảng online check (`/api/license/verify`).

---

## 3. Thiết lập Supabase (từng bước)

### 3.1 Tạo project
1. https://supabase.com → New project  
2. Region gần VN/SG  
3. Lưu **Database password** offline  

### 3.2 Lấy keys (Settings → API)
| Key | Dùng ở đâu |
|-----|------------|
| `anon` `public` | Desktop/web client (có RLS) |
| `service_role` | **Chỉ Vercel server** — tuyệt đối không ship vào app |

### 3.3 Auth
Dashboard → Authentication → Providers:
- **Email** (magic link hoặc password)
- (Tuỳ) Google OAuth  

URL config (khi có web admin):
- Site URL: `https://your-app.vercel.app`
- Redirect: `https://your-app.vercel.app/auth/callback`

### 3.4 Schema SQL (chạy trong SQL Editor)

```sql
-- Profiles (1-1 với auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'customer' check (role in ('customer','admin')),
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  hwid text not null,
  label text,
  last_seen_at timestamptz default now(),
  created_at timestamptz not null default now(),
  unique (user_id, hwid)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  plan text not null check (plan in ('month','year','lifetime')),
  amount_vnd int not null,
  status text not null default 'pending'
    check (status in ('pending','paid','rejected','refunded')),
  transfer_content text,
  hwid text,
  bill_path text,
  note text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id),
  plan text not null check (plan in ('trial','pro','vip')),
  hwid text not null,
  status text not null default 'active'
    check (status in ('active','revoked','expired')),
  exp_at timestamptz not null,
  -- token HMAC do server issue (optional store hash only — safer)
  token_hash text,
  activation_code text unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.audit_logs (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  meta jsonb default '{}',
  created_at timestamptz not null default now()
);

-- Auto profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

### 3.5 RLS (bảo mật dữ liệu — bắt buộc bật)

```sql
alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.orders enable row level security;
alter table public.licenses enable row level security;
alter table public.audit_logs enable row level security;

-- Helper: is admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- profiles: user đọc/sửa chính mình
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- devices: own
create policy "devices_all_own" on public.devices
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- orders: own read; insert own pending; admin all
create policy "orders_select_own" on public.orders
  for select using (user_id = auth.uid() or public.is_admin());
create policy "orders_insert_own" on public.orders
  for insert with check (user_id = auth.uid());
create policy "orders_admin_update" on public.orders
  for update using (public.is_admin());

-- licenses: own read only (issue chỉ server service_role)
create policy "licenses_select_own" on public.licenses
  for select using (user_id = auth.uid() or public.is_admin());
-- Không policy INSERT/UPDATE cho anon/authenticated → chỉ service_role

-- audit: admin only
create policy "audit_admin" on public.audit_logs
  for select using (public.is_admin());
```

### 3.6 Gán admin đầu tiên
Sau khi bạn signup email seller:

```sql
update public.profiles
set role = 'admin'
where email = 'ban@email.com';
```

---

## 4. Thiết lập Vercel

### 4.1 Deploy API (2 hướng)

**A. Tách mini Next API** (khuyến nghị lúc đầu)  
Repo riêng hoặc folder `cloud/` chỉ có:
- Auth helpers
- `/api/license/issue`
- `/api/license/activate`
- `/api/orders/create`
- `/api/orders/confirm` (admin)
- `/api/webhooks/...`

**B. Dùng chung monorepo**  
Deploy Next từ root — cẩn thận: desktop Electron code không cần lên Vercel; chỉ route cloud.

### 4.2 Environment Variables (Vercel Project → Settings → Env)

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...     # Server only
AINOVEL_ENTITLEMENT_SECRET=...       # Giống secret ký HMAC desktop
AINOVEL_ENTITLEMENT_ADMIN_KEY=...    # Optional admin HTTP
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Production + Preview: set riêng; **không** commit.

### 4.3 Ví dụ route issue license (server)

```ts
// Pseudocode — Vercel Route Handler
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'

// service role — bypass RLS có kiểm soát
const admin = createClient(url, SERVICE_ROLE)

export async function POST(req: Request) {
  // 1. Verify caller: Supabase JWT user is admin OR x-admin-key
  // 2. Load order paid + hwid
  // 3. Issue HMAC token (cùng thuật toán src/lib/entitlement.ts)
  // 4. Insert licenses row (store token_hash = sha256(token), not raw if possible)
  // 5. audit_logs
  // 6. Return { token } or { activation_code } one-time
}
```

**Đồng bộ thuật toán:** port `issueEntitlementToken` / `verifyEntitlementToken` sang package shared, hoặc gọi lại logic TypeScript y hệt secret.

---

## 5. Luồng user end-to-end

### 5.1 Đăng ký / đăng nhập
1. Desktop hoặc web: Supabase Auth (email magic link)  
2. Lưu `access_token` + `refresh_token` an toàn (Electron: `safeStorage` / keytar — không localStorage plain nếu có thể)

### 5.2 Mua Pro
1. User login → chọn gói → app gửi `POST /api/orders` với `hwid`, `plan`  
2. Server tạo `orders` pending + `transfer_content = CAP … HWID`  
3. UI hiện QR (có thể generate VietQR server-side)  
4. User CK → bấm «Đã thanh toán» → Telegram + `orders` note  
5. **Admin** (bạn) confirm paid trên dashboard Vercel/Supabase Table  
6. Server issue license → push token hoặc mã AINOVEL  
7. Desktop activate → header PRO

### 5.3 Trial
```
POST /api/license/trial { hwid }
```
Server: 1 trial / hwid (bảng `licenses` plan=trial, exp +3d) — thay vault file local dần.

### 5.4 Online verify (bảo mật hơn HMAC thuần)
```
POST /api/license/heartbeat { hwid, token }
```
- Token HMAC valid + row `licenses.status=active` + `exp_at`  
- Revoke trên Supabase → heartbeat fail → desktop về Free  

Grace offline: 7 ngày dùng cache last-success (tuỳ policy).

---

## 6. Bảo mật dữ liệu — checklist

| Mục | Cách làm |
|-----|----------|
| RLS bật mọi bảng user data | §3.5 |
| service_role chỉ Vercel | Không bundle Electron |
| Secret license chỉ server | Issue trên Vercel |
| HTTPS only | Vercel default |
| Không log token full | Log `token_hash` / 8 ký tự cuối |
| Bill ảnh | Storage bucket private + signed URL |
| Admin | `profiles.role=admin` + policy |
| Rate limit | Vercel middleware / Upstash (activate, trial) |
| GDPR-light | User export/delete: cascade profiles |
| Backup | Supabase daily backup / PITR (plan Pro) |
| Desktop project files | Vẫn local; **không** upload lore/API keys trừ khi user bật sync |

### Không nên
- Client gọi Supabase `service_role`
- Policy `using (true)` cho write
- Lưu API key Gemini của user lên cloud (trừ vault mã hóa + consent)
- Tin HWID từ client mà không có token/session

---

## 7. Dashboard quản lý (bạn)

### Tối giản (nhanh)
1. Supabase Table Editor: lọc `orders status=pending`  
2. Update `paid` → gọi script issue (local `license:issue` với secret)  
3. Gửi key Zalo  

### Chuyên nghiệp (Vercel web)
- Page `/admin` (chỉ admin JWT)  
- List orders, nút **Confirm & Issue**  
- List licenses, nút **Revoke**  
- Search email / HWID  

---

## 8. Lộ trình triển khai (thực tế)

| Phase | Việc | Thời gian gợi ý |
|-------|------|-----------------|
| **P0** | Supabase project + SQL + RLS + 1 admin user | 0.5–1 ngày |
| **P1** | Vercel API: login session, create order, issue license | 1–2 ngày |
| **P2** | Desktop: login UI + fetch token online (giữ redeem local) | 1–2 ngày |
| **P3** | Admin dashboard + Telegram webhook + revoke heartbeat | 1–2 ngày |
| **P4** | Optional: sync project cloud (encrypted) | sau |

**Không bắt buộc** chuyển hết local vault ngay — hybrid:
- Hiện tại: Zalo + `license:issue` local vẫn bán được  
- Cloud: thêm khi cần quản lý nhiều user / revoke / báo cáo  

---

## 9. Env mapping tóm tắt

### Vercel
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AINOVEL_ENTITLEMENT_SECRET
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

### Desktop packaged (máy khách)
```
# Không nhét Supabase service role
# Có thể:
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# License verify base:
AINOVEL_LICENSE_API=https://your-api.vercel.app
```

### Máy seller (nếu vẫn issue offline)
```
AINOVEL_ENTITLEMENT_MODE=enforce
AINOVEL_ENTITLEMENT_SECRET=   # TRÙNG Vercel
```

---

## 10. Câu trả lời thẳng

| Câu | Trả lời |
|-----|---------|
| Quản lý user bằng gì? | **Supabase Auth** + bảng `profiles` / `orders` / `licenses` |
| Bảo mật data? | **RLS** + service_role chỉ Vercel + không lộ secret HMAC |
| Vercel làm gì? | API trung gian: issue/revoke/confirm — không để desktop nói chuyện thẳng DB nhạy cảm |
| App desktop đổi nhiều không? | Thêm login + gọi API activate; keep verify HMAC offline |
| Bán ngay chưa cần Supabase? | **Có** — Zalo + license local; Supabase khi scale / revoke / nhiều user |

---

## 11. Việc bạn làm tuần này (nếu chọn cloud)

1. Tạo project Supabase → chạy SQL §3.4–3.5  
2. Signup email admin → `update profiles set role='admin'`  
3. Tạo project Vercel → gắn env §4.2  
4. Implement 3 route: `orders/create`, `orders/confirm`, `license/issue`  
5. Desktop: nút «Đăng nhập» + «Đồng bộ license» gọi Vercel  

Khi cần implement code trong repo (shared entitlement package + API routes cloud), nói rõ chọn **Phase P1** để agent code tiếp.
