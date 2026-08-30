import re

def apply(path, edits):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    for name, old, new in edits:
        count = content.count(old)
        if count != 1:
            print(f"[{path}] WARNING: '{name}' matched {count} times (expected 1) - skipped")
            continue
        content = content.replace(old, new)
        print(f"[{path}] Applied: {name}")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

# ---------- backend/src/routes/auth.js ----------
apply("backend/src/routes/auth.js", [
    ("register: include can_post",
"""    const result = await pool.query(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2)
       RETURNING id, username, is_admin, created_at`,
      [username, passwordHash]
    );

    const user = result.rows[0];
    const token = signToken(user);
    res.status(201).json({ token, user: { id: user.id, username: user.username, isAdmin: user.is_admin } });""",
"""    const result = await pool.query(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2)
       RETURNING id, username, is_admin, can_post, created_at`,
      [username, passwordHash]
    );

    const user = result.rows[0];
    const token = signToken(user);
    res.status(201).json({ token, user: { id: user.id, username: user.username, isAdmin: user.is_admin, canPost: user.can_post } });"""),

    ("login: include can_post",
"""    const token = signToken(user);
    res.json({ token, user: { id: user.id, username: user.username, isAdmin: user.is_admin } });""",
"""    const token = signToken(user);
    res.json({ token, user: { id: user.id, username: user.username, isAdmin: user.is_admin, canPost: user.can_post } });"""),

    ("/me: include can_post",
"""    const result = await pool.query(
      'SELECT id, username, is_admin, created_at FROM users WHERE id = $1',
      [req.user.id]
    );""",
"""    const result = await pool.query(
      'SELECT id, username, is_admin, can_post, created_at FROM users WHERE id = $1',
      [req.user.id]
    );"""),
])

# ---------- backend/src/routes/tickets.js ----------
apply("backend/src/routes/tickets.js", [
    ("gate ticket creation behind approval",
"""router.post('/', requireAuth, async (req, res, next) => {
  try {
    const t = ticketSchema.parse(req.body);""",
"""router.post('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.user.isAdmin) {
      const approval = await pool.query('SELECT can_post FROM users WHERE id = $1', [req.user.id]);
      if (!approval.rows[0] || !approval.rows[0].can_post) {
        return res.status(403).json({ error: 'not_approved' });
      }
    }
    const t = ticketSchema.parse(req.body);"""),
])

# ---------- backend/src/routes/admin.js ----------
apply("backend/src/routes/admin.js", [
    ("GET /users: include can_post",
"""      'SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC'""",
"""      'SELECT id, username, is_admin, can_post, created_at FROM users ORDER BY created_at DESC'"""),

    ("schemas: add canPost",
"""const createUserSchema = z.object({
  username: z.string().trim().min(3).max(254).regex(usernameRegex, 'Use letters, numbers, and _ . @ - only'),
  password: z.string().min(8).max(200),
  isAdmin: z.boolean().optional().default(false),
});
const updateUserRoleSchema = z.object({ isAdmin: z.boolean() });""",
"""const createUserSchema = z.object({
  username: z.string().trim().min(3).max(254).regex(usernameRegex, 'Use letters, numbers, and _ . @ - only'),
  password: z.string().min(8).max(200),
  isAdmin: z.boolean().optional().default(false),
  canPost: z.boolean().optional().default(false),
});
const updateUserRoleSchema = z.object({
  isAdmin: z.boolean().optional(),
  canPost: z.boolean().optional(),
}).refine(v => v.isAdmin !== undefined || v.canPost !== undefined, { message: 'Provide isAdmin and/or canPost' });"""),

    ("POST /users: insert can_post",
"""    const { username, password, isAdmin } = createUserSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, is_admin) VALUES ($1,$2,$3)
       RETURNING id, username, is_admin, created_at`,
      [username, passwordHash, isAdmin]
    );""",
"""    const { username, password, isAdmin, canPost } = createUserSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, is_admin, can_post) VALUES ($1,$2,$3,$4)
       RETURNING id, username, is_admin, can_post, created_at`,
      [username, passwordHash, isAdmin, canPost]
    );"""),

    ("PATCH /users/:id: support canPost toggle",
"""router.patch('/users/:id', async (req, res, next) => {
  try {
    const { isAdmin } = updateUserRoleSchema.parse(req.body);
    if (req.params.id === req.user.id && !isAdmin) {
      return res.status(400).json({ error: 'You cannot remove your own admin access' });
    }
    const result = await pool.query(
      'UPDATE users SET is_admin = $1 WHERE id = $2 RETURNING id, username, is_admin, created_at',
      [isAdmin, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});""",
"""router.patch('/users/:id', async (req, res, next) => {
  try {
    const { isAdmin, canPost } = updateUserRoleSchema.parse(req.body);
    if (isAdmin !== undefined && req.params.id === req.user.id && !isAdmin) {
      return res.status(400).json({ error: 'You cannot remove your own admin access' });
    }
    const sets = [];
    const values = [];
    let i = 1;
    if (isAdmin !== undefined) { sets.push(`is_admin = $${i++}`); values.push(isAdmin); }
    if (canPost !== undefined) { sets.push(`can_post = $${i++}`); values.push(canPost); }
    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, username, is_admin, can_post, created_at`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});"""),
])

# ---------- frontend/index.html ----------
apply("frontend/index.html", [
    ("add ja: {} translations",
"""  const I18N = {
    ja: {""",
"""  const I18N = {
    ja: {
      can_post_label: '出品可能', cannot_post_label: '出品不可（承認待ち）',
      enable_posting_btn: '出品を許可', disable_posting_btn: '出品を禁止',
      seller_approval_title: '出品には承認が必要です',
      seller_approval_body: '出品を有効にするには、開発者にコーヒーをおごってください。下のTelegramリンクから送金し、確認後に管理者が手動で出品を許可します。',
      seller_approval_telegram_btn: 'Telegramで連絡する',"""),

    ("add en: {} translations",
"""    en: {""",
"""    en: {
      can_post_label: 'Can post listings', cannot_post_label: 'Cannot post yet (awaiting approval)',
      enable_posting_btn: 'Enable posting', disable_posting_btn: 'Disable posting',
      seller_approval_title: 'Approval required to create a listing',
      seller_approval_body: 'To enable posting, please buy the developer a coffee. Send it via the Telegram link below, and the admin will manually enable your account once payment is confirmed.',
      seller_approval_telegram_btn: 'Message on Telegram',"""),

    ("admin user rows: add can-post status + toggle button",
"""    let userRows = users.map(u => `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div class="stub-title" style="font-size:13.5px;">${esc(u.username)}${u.is_admin? ' 👑':''}</div>
            <div class="small">${t('created_label')}: ${new Date(u.created_at).toLocaleDateString()}</div>
          </div>
        </div>
        <div class="row-btns" style="margin-top:10px;">
          <button class="btn btn-outline btn-sm" data-action="toggle-admin" data-id="${u.id}" data-current="${u.is_admin}">${u.is_admin? t('demote_btn') : t('promote_btn')}</button>
          <button class="btn btn-danger btn-sm" data-action="delete-user" data-id="${u.id}">${t('delete_btn')}</button>
        </div>
      </div>`).join('');""",
"""    let userRows = users.map(u => `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div class="stub-title" style="font-size:13.5px;">${esc(u.username)}${u.is_admin? ' 👑':''}</div>
            <div class="small">${t('created_label')}: ${new Date(u.created_at).toLocaleDateString()}</div>
            <div class="small">${u.can_post ? t('can_post_label') : t('cannot_post_label')}</div>
          </div>
        </div>
        <div class="row-btns" style="margin-top:10px;">
          <button class="btn btn-outline btn-sm" data-action="toggle-admin" data-id="${u.id}" data-current="${u.is_admin}">${u.is_admin? t('demote_btn') : t('promote_btn')}</button>
          <button class="btn btn-outline btn-sm" data-action="toggle-can-post" data-id="${u.id}" data-current="${u.can_post}">${u.can_post? t('disable_posting_btn') : t('enable_posting_btn')}</button>
          <button class="btn btn-danger btn-sm" data-action="delete-user" data-id="${u.id}">${t('delete_btn')}</button>
        </div>
      </div>`).join('');"""),

    ("create-listing submit: handle not_approved error nicely",
"""        try{
          const result = editId
            ? await api('/tickets/'+editId, { method:'PUT', body: payload })
            : await api('/tickets', { method:'POST', body: payload });
          toast(editId? t('ticket_updated_toast') : t('ticket_created_toast'));
          go('ticketdetail', { id: result.ticket.id });
        }catch(err){
          root.querySelector('#form-error').textContent = err.message;
        }""",
"""        try{
          const result = editId
            ? await api('/tickets/'+editId, { method:'PUT', body: payload })
            : await api('/tickets', { method:'POST', body: payload });
          toast(editId? t('ticket_updated_toast') : t('ticket_created_toast'));
          go('ticketdetail', { id: result.ticket.id });
        }catch(err){
          if(err.message === 'not_approved'){
            root.querySelector('#form-error').innerHTML = `<div style="margin-top:8px;">
              <div style="font-weight:700; margin-bottom:4px;">${t('seller_approval_title')}</div>
              <div style="margin-bottom:8px;">${t('seller_approval_body')}</div>
              <a class="btn btn-primary btn-sm" href="https://t.me/superbram002" target="_blank" rel="noopener">${t('seller_approval_telegram_btn')}</a>
            </div>`;
          } else {
            root.querySelector('#form-error').textContent = err.message;
          }
        }"""),

    ("admin panel: add toggle-can-post action handler",
"""        if(action==='toggle-admin'){
          const makingAdmin = el.getAttribute('data-current') !== 'true';
          try{
            await api(`/admin/users/${id}`, { method:'PATCH', body:{ isAdmin: makingAdmin } });
            toast(makingAdmin ? t('promoted_toast') : t('demoted_toast'));
            go('admin', { adminTab:'users' });
          }catch(err){ toast(err.message); }
        }""",
"""        if(action==='toggle-admin'){
          const makingAdmin = el.getAttribute('data-current') !== 'true';
          try{
            await api(`/admin/users/${id}`, { method:'PATCH', body:{ isAdmin: makingAdmin } });
            toast(makingAdmin ? t('promoted_toast') : t('demoted_toast'));
            go('admin', { adminTab:'users' });
          }catch(err){ toast(err.message); }
        }

        if(action==='toggle-can-post'){
          const enabling = el.getAttribute('data-current') !== 'true';
          try{
            await api(`/admin/users/${id}`, { method:'PATCH', body:{ canPost: enabling } });
            toast(enabling ? t('enable_posting_btn') : t('disable_posting_btn'));
            go('admin', { adminTab:'users' });
          }catch(err){ toast(err.message); }
        }"""),
])

# ---------- new migration file ----------
import os
os.makedirs("backend/migrations", exist_ok=True)
with open("backend/migrations/004_seller_approval.sql", "w", encoding="utf-8") as f:
    f.write(
"""ALTER TABLE users ADD COLUMN can_post BOOLEAN NOT NULL DEFAULT false;

-- Grandfather in every account that existed before this feature shipped,
-- so existing sellers are not suddenly blocked from posting new listings.
UPDATE users SET can_post = true;
"""
    )
print("Created backend/migrations/004_seller_approval.sql")

print("\\nDone. Review with: git diff")
