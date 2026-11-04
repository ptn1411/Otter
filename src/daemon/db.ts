import { Database } from "bun:sqlite";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

export function getOtterDir(): string {
  const dir = process.env.OTTER_HOME || path.join(os.homedir(), ".otter");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getDefaultDatabasePath(): string {
  if (process.env.OTTER_DB_PATH) return process.env.OTTER_DB_PATH;
  const otterDir = getOtterDir();
  const newPath = path.join(otterDir, "storage.sqlite");

  // Tự động sao chép dữ liệu từ root project sang ~/.otter/ nếu chưa có
  const localOtterPath = path.resolve("otter-storage.sqlite");
  const legacyChatmcpPath = path.resolve("chatmcp-storage.sqlite");
  const legacySource = fs.existsSync(localOtterPath) ? localOtterPath : (fs.existsSync(legacyChatmcpPath) ? legacyChatmcpPath : null);

  if (!fs.existsSync(newPath) && legacySource) {
    try {
      fs.copyFileSync(legacySource, newPath);
      console.log(`[Database] 📦 Đã tự động đồng bộ dữ liệu cũ từ ${legacySource} sang ${newPath}`);
    } catch (err) {
      console.warn("[Database] Không thể sao chép database cũ:", err);
    }
  }

  return newPath;
}

export function initDatabase(dbPath: string = getDefaultDatabasePath()): Database {
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");

  db.run(`
    CREATE TABLE IF NOT EXISTS conversation_scopes (
      conversation_id TEXT PRIMARY KEY,
      conversation_url TEXT NOT NULL,
      pair_code TEXT,
      bound_at INTEGER NOT NULL,
      status TEXT CHECK(status IN ('pending', 'bound', 'revoked')) DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      title TEXT,
      status TEXT CHECK(status IN ('pending', 'running', 'waiting_approval', 'completed', 'failed')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT CHECK(status IN ('waiting', 'approved', 'rejected')) DEFAULT 'waiting',
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS timeline_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_settings (
      conversation_id TEXT PRIMARY KEY,
      continuous_enabled INTEGER DEFAULT 0,
      mcp_usage_enabled INTEGER DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS immediate_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bookmarks_url ON bookmarks(url);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_created ON bookmarks(created_at);

    CREATE TABLE IF NOT EXISTS custom_commands (
      id TEXT PRIMARY KEY,
      slash TEXT NOT NULL UNIQUE,
      icon TEXT DEFAULT '⚡',
      category TEXT DEFAULT 'Tập lệnh của tôi',
      title TEXT NOT NULL,
      description TEXT,
      prompt_template TEXT NOT NULL,
      is_pinned INTEGER DEFAULT 0,
      usage_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_custom_commands_slash ON custom_commands(slash);
    CREATE INDEX IF NOT EXISTS idx_custom_commands_pinned ON custom_commands(is_pinned);

    CREATE TABLE IF NOT EXISTS scheduled_chatgpt_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
      scheduled_at INTEGER NOT NULL,
      repeat_minutes INTEGER DEFAULT 0,
      chat_url TEXT,
      response_text TEXT,
      screenshot_path TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_chatgpt_tasks(status, scheduled_at);
  `);

  // Phase 1 (continuous-coding loop): plans + plan tasks. CREATE TABLE IF NOT
  // EXISTS is safe on re-run; tasks columns are added only if missing, so
  // existing databases are migrated in place without losing data.
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL DEFAULT 'chatgpt-web',
      goal TEXT NOT NULL,
      loop_prompt TEXT,
      status TEXT CHECK(status IN ('draft', 'running', 'paused', 'done', 'failed', 'cancelled')) NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plan_tasks (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id),
      order_index INTEGER NOT NULL,
      goal TEXT NOT NULL,
      details TEXT,
      files_hint_json TEXT,
      verify_json TEXT,
      depends_on_json TEXT,
      status TEXT CHECK(status IN ('pending', 'running', 'success', 'failed', 'blocked', 'skipped')) NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      last_heartbeat_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_plan_tasks_plan_order ON plan_tasks(plan_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
  `);

  const taskColumns = new Set(
    (db.query("PRAGMA table_info(tasks)").all() as { name: string }[]).map((c) => c.name),
  );
  const addTaskColumn = (name: string, ddl: string) => {
    if (!taskColumns.has(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${ddl}`);
  };
  // Note: the original tasks.status CHECK does not include 'waiting_approval'
  // in every historical schema variant; we do not rewrite that CHECK here to
  // avoid breaking existing rows. New plan-related columns only.
  addTaskColumn("plan_id", "plan_id TEXT");
  addTaskColumn("plan_task_id", "plan_task_id TEXT");
  addTaskColumn("attempt_count", "attempt_count INTEGER NOT NULL DEFAULT 0");
  addTaskColumn("last_heartbeat_at", "last_heartbeat_at INTEGER");
  // Phase 2: persist the full dispatch payload so a queue can be rebuilt
  // after a daemon restart (previously only title/status were stored).
  addTaskColumn("details", "details TEXT");
  addTaskColumn("files_hint_json", "files_hint_json TEXT");
  addTaskColumn("verify_json", "verify_json TEXT");
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id, plan_task_id)`);

  // Phase 5: injection outbox. A prompt that cannot be delivered to ChatGPT
  // Web right now is kept here (deduplicated by text hash) and retried when
  // the extension reconnects, instead of being lost.
  db.exec(`
    CREATE TABLE IF NOT EXISTS injection_outbox (
      id TEXT PRIMARY KEY,
      plan_id TEXT,
      task_id TEXT,
      text_hash TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'delivered', 'failed')) NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      delivered_at INTEGER,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON injection_outbox(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_outbox_hash ON injection_outbox(text_hash, status);
  `);

  // FB Reply Loop (2026-10-31): phiên trả lời bình luận + từng bình luận.
  // CREATE TABLE IF NOT EXISTS chạy lại an toàn; UNIQUE(run_id, comment_key)
  // là lớp chống gửi trùng ở tầng DB, bên cạnh logic ở fb-reply.ts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS fb_reply_runs (
      id TEXT PRIMARY KEY,
      post_url TEXT NOT NULL,
      mode TEXT CHECK(mode IN ('draft', 'auto')) NOT NULL DEFAULT 'draft',
      status TEXT CHECK(status IN ('running', 'paused', 'done', 'blocked', 'stopped')) NOT NULL DEFAULT 'running',
      max_replies INTEGER NOT NULL DEFAULT 20,
      max_run_minutes INTEGER NOT NULL DEFAULT 60,
      tone TEXT,
      skip_rules_json TEXT,
      include_replies INTEGER NOT NULL DEFAULT 0,
      from_run_id TEXT,
      sent_count INTEGER NOT NULL DEFAULT 0,
      draft_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      last_sent_at INTEGER,
      blocked_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fb_reply_comments (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES fb_reply_runs(id),
      comment_key TEXT NOT NULL,
      author TEXT,
      excerpt TEXT,
      status TEXT CHECK(status IN ('pending', 'drafted', 'sent', 'skipped', 'failed')) NOT NULL DEFAULT 'pending',
      draft_text TEXT,
      skip_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(run_id, comment_key)
    );

    CREATE INDEX IF NOT EXISTS idx_fb_reply_comments_run_status ON fb_reply_comments(run_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_fb_reply_runs_post_status ON fb_reply_runs(post_url, status);
  `);

  // FB Auto Post (2026-10-31): phiên đăng bài digest + từng tin RSS.
  // CREATE TABLE IF NOT EXISTS chạy lại an toàn; UNIQUE(run_id, item_key)
  // là lớp chống đăng trùng tin trong một phiên, bên cạnh logic ở
  // fb-post.ts. fb_post_digests đếm số BÀI đã đăng (mỗi lần mark_posted
  // thành công ghi một dòng, UNIQUE(run_id, digest_hash) chống đếm
  // trùng khi gọi mark_posted hai lần) — khác với số item posted.
  // posted_count trong fb_post_runs cũng đếm theo số bài digest này.
  db.exec(`
    CREATE TABLE IF NOT EXISTS fb_post_runs (
      id TEXT PRIMARY KEY,
      target_url TEXT NOT NULL,
      mode TEXT CHECK(mode IN ('auto')) NOT NULL DEFAULT 'auto',
      status TEXT CHECK(status IN ('running', 'paused', 'done', 'blocked', 'stopped')) NOT NULL DEFAULT 'running',
      max_posts INTEGER NOT NULL DEFAULT 1,
      max_run_minutes INTEGER NOT NULL DEFAULT 60,
      digest_size INTEGER NOT NULL DEFAULT 5,
      feeds_json TEXT,
      posted_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      last_posted_at INTEGER,
      blocked_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fb_post_items (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES fb_post_runs(id),
      item_key TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT NOT NULL,
      source TEXT,
      pub_date_ms INTEGER,
      excerpt TEXT,
      status TEXT CHECK(status IN ('pending', 'posted', 'failed', 'skipped')) NOT NULL DEFAULT 'pending',
      skip_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(run_id, item_key)
    );

    CREATE TABLE IF NOT EXISTS fb_post_digests (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES fb_post_runs(id),
      digest_hash TEXT NOT NULL,
      item_keys_json TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(run_id, digest_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_fb_post_items_run_status ON fb_post_items(run_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_fb_post_runs_target_status ON fb_post_runs(target_url, status);
  `);

  // FB Feed Engagement (2026-10-31): sổ tương tác Bảng feed Facebook
  db.exec(`
    CREATE TABLE IF NOT EXISTS fb_feed_engagements (
      id TEXT PRIMARY KEY,
      post_key TEXT NOT NULL UNIQUE,
      author TEXT NOT NULL,
      post_snippet TEXT,
      reaction TEXT CHECK(reaction IN ('like', 'love', 'none')) NOT NULL DEFAULT 'like',
      comment_text TEXT,
      status TEXT CHECK(status IN ('liked', 'commented', 'both', 'skipped', 'failed')) NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fb_feed_engagements_key ON fb_feed_engagements(post_key);
    CREATE INDEX IF NOT EXISTS idx_fb_feed_engagements_created ON fb_feed_engagements(created_at);

    -- FB Sales Playbook & Messenger Conversation History (2026-11-01)
    CREATE TABLE IF NOT EXISTS fb_conversations (
      id TEXT PRIMARY KEY,
      recipient_name TEXT NOT NULL,
      profile_url TEXT,
      stage TEXT CHECK(stage IN ('greeting', 'discovery', 'pitch', 'objection', 'closing', 'support', 'done')) NOT NULL DEFAULT 'greeting',
      product_interest TEXT,
      notes TEXT,
      last_message_text TEXT,
      last_message_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fb_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES fb_conversations(id),
      sender TEXT CHECK(sender IN ('customer', 'bot')) NOT NULL,
      text TEXT NOT NULL,
      stage_at_send TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fb_sales_playbook (
      id TEXT PRIMARY KEY,
      stage TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      goal TEXT NOT NULL,
      templates_json TEXT NOT NULL DEFAULT '[]',
      rules_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fb_sales_intents (
      id TEXT PRIMARY KEY,
      intent_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      reply_template TEXT NOT NULL,
      next_stage TEXT NOT NULL DEFAULT 'closing',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fb_sales_comments (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      templates_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_fb_conversations_stage ON fb_conversations(stage, last_message_at);
    CREATE INDEX IF NOT EXISTS idx_fb_messages_conv ON fb_messages(conversation_id, created_at);

    -- FB Scheduled Group Posting (2026-11-01)
    CREATE TABLE IF NOT EXISTS fb_group_targets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      topic TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fb_group_schedules (
      id TEXT PRIMARY KEY,
      mode TEXT CHECK(mode IN ('preset', 'ai_generated')) NOT NULL DEFAULT 'preset',
      content TEXT NOT NULL,
      target_group_ids TEXT NOT NULL DEFAULT '[]',
      scheduled_at INTEGER NOT NULL,
      interval_seconds INTEGER NOT NULL DEFAULT 180,
      status TEXT CHECK(status IN ('pending', 'running', 'completed', 'paused', 'cancelled', 'failed')) NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS fb_group_post_queue (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES fb_group_schedules(id),
      target_group_id TEXT NOT NULL REFERENCES fb_group_targets(id),
      group_url TEXT NOT NULL,
      group_name TEXT NOT NULL,
      content TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      status TEXT CHECK(status IN ('pending', 'posting', 'posted', 'failed', 'skipped')) NOT NULL DEFAULT 'pending',
      error_message TEXT,
      posted_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_fb_group_targets_enabled ON fb_group_targets(enabled);
    CREATE INDEX IF NOT EXISTS idx_fb_group_schedules_status ON fb_group_schedules(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_fb_group_queue_pending ON fb_group_post_queue(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_fb_group_queue_schedule ON fb_group_post_queue(schedule_id);

    -- FB Media Posting & Batch Video Queue (2026-11-03)
    CREATE TABLE IF NOT EXISTS fb_media_posts (
      id TEXT PRIMARY KEY,
      target_type TEXT CHECK(target_type IN ('profile', 'group', 'page')) NOT NULL DEFAULT 'profile',
      target_url TEXT NOT NULL DEFAULT 'https://www.facebook.com/',
      target_name TEXT,
      media_path TEXT,
      media_type TEXT CHECK(media_type IN ('video', 'image', 'none')) NOT NULL DEFAULT 'video',
      caption TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      interval_seconds INTEGER NOT NULL DEFAULT 180,
      status TEXT CHECK(status IN ('pending', 'uploading', 'posted', 'failed', 'cancelled')) NOT NULL DEFAULT 'pending',
      error_message TEXT,
      posted_at INTEGER,
      source TEXT CHECK(source IN ('folder', 'list', 'muse', 'manual')) NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_fb_media_posts_pending ON fb_media_posts(status, scheduled_at);
  `);

  // Loop controller (2026-10-31): state machine for the standard coding
  // loop (docs/plans/2026-10-31-standard-coding-loop.md). One loop run is
  // bound to one plan; attempts carry the failing evidence; suite runs
  // carry the final-gate verdicts. CREATE TABLE IF NOT EXISTS is safe on
  // re-run. Sync to `nam` is NOT recorded here — it stays a manual step.
  db.exec(`
    CREATE TABLE IF NOT EXISTS loop_runs (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id),
      status TEXT CHECK(status IN ('running', 'paused', 'blocked', 'finished', 'stopped')) NOT NULL DEFAULT 'running',
      max_turns INTEGER NOT NULL DEFAULT 20,
      max_minutes INTEGER NOT NULL DEFAULT 60,
      turns_used INTEGER NOT NULL DEFAULT 0,
      no_progress_turns INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      deadline_ms INTEGER NOT NULL,
      blocked_reason TEXT,
      decision_needed TEXT,
      final_gate_passed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loop_attempts (
      id TEXT PRIMARY KEY,
      loop_id TEXT NOT NULL REFERENCES loop_runs(id),
      plan_task_id TEXT NOT NULL REFERENCES plan_tasks(id),
      attempt_no INTEGER NOT NULL,
      outcome TEXT CHECK(outcome IN ('passed', 'failed')) NOT NULL,
      test_name TEXT,
      output_excerpt TEXT,
      changed_files_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loop_suite_runs (
      id TEXT PRIMARY KEY,
      loop_id TEXT REFERENCES loop_runs(id),
      suite_id TEXT NOT NULL,
      passed INTEGER NOT NULL DEFAULT 0,
      exit_code INTEGER,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      output_excerpt TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_loop_runs_plan_status ON loop_runs(plan_id, status);
    CREATE INDEX IF NOT EXISTS idx_loop_attempts_loop_task ON loop_attempts(loop_id, plan_task_id, attempt_no);
    CREATE INDEX IF NOT EXISTS idx_loop_suite_runs_loop ON loop_suite_runs(loop_id, created_at);
  `);

  // Fleet / multi-node (2026-10-31): hub tables + worker inbox.
  // Tokens are NEVER stored here (see fleet.ts). UNIQUE/PK on
  // dispatch_id is the idempotency layer against duplicate delivery.
  db.exec(`
    CREATE TABLE IF NOT EXISTS fleet_nodes (
      node_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_base TEXT NOT NULL,
      projects_json TEXT NOT NULL DEFAULT '[]',
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      last_heartbeat INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fleet_dispatches (
      dispatch_id TEXT PRIMARY KEY,
      parent_plan_id TEXT,
      node_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      tasks_json TEXT NOT NULL DEFAULT '[]',
      project_root TEXT,
      status TEXT CHECK(status IN ('pending', 'running', 'done', 'blocked', 'timed_out', 'cancelled', 'failed')) NOT NULL DEFAULT 'pending',
      result_excerpt TEXT,
      worker_plan_id TEXT,
      deadline_ms INTEGER NOT NULL DEFAULT 3600000,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fleet_inbox (
      dispatch_id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      tasks_json TEXT NOT NULL DEFAULT '[]',
      project_root TEXT,
      verify_json TEXT NOT NULL DEFAULT '[]',
      status TEXT CHECK(status IN ('pending', 'running', 'done', 'blocked', 'timed_out', 'cancelled', 'failed')) NOT NULL DEFAULT 'running',
      plan_id TEXT,
      result_excerpt TEXT,
      deadline_ms INTEGER NOT NULL DEFAULT 3600000,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_fleet_dispatches_node ON fleet_dispatches(node_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_fleet_inbox_status ON fleet_inbox(status, created_at);
  `);

  // Page-loop (2026-10-31, plan nâng cấp từ codex-web): phiên vòng lặp
  // trên trang, lease, token hash (KHÔNG lưu token thật), receipt gửi,
  // checkpoint compaction. CREATE TABLE IF NOT EXISTS chạy lại an toàn.
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_loops (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL DEFAULT 'chatgpt-web',
      plan_id TEXT,
      goal TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'auto',
      chat_mode TEXT NOT NULL DEFAULT 'retained',
      status TEXT CHECK(status IN ('armed','waiting_generation','settling','deciding','injecting','paused','done','blocked','stopped')) NOT NULL DEFAULT 'armed',
      turn_count INTEGER NOT NULL DEFAULT 0,
      max_turns INTEGER NOT NULL DEFAULT 10,
      max_run_minutes INTEGER NOT NULL DEFAULT 30,
      epoch INTEGER NOT NULL DEFAULT 0,
      context_budget INTEGER NOT NULL DEFAULT 90000,
      context_used_estimate INTEGER NOT NULL DEFAULT 0,
      last_turn_hash TEXT,
      no_progress_count INTEGER NOT NULL DEFAULT 0,
      blocked_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS page_loop_turns (
      id TEXT PRIMARY KEY,
      loop_id TEXT NOT NULL REFERENCES page_loops(id),
      turn_index INTEGER NOT NULL,
      turn_hash TEXT NOT NULL,
      excerpt TEXT,
      is_done_marker INTEGER NOT NULL DEFAULT 0,
      is_checkpoint_marker INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS page_loop_leases (
      id TEXT PRIMARY KEY,
      loop_id TEXT NOT NULL REFERENCES page_loops(id),
      tab_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL DEFAULT 'chatgpt-web',
      status TEXT CHECK(status IN ('active','stale','released')) NOT NULL DEFAULT 'active',
      heartbeat_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS page_loop_turn_tokens (
      id TEXT PRIMARY KEY,
      loop_id TEXT NOT NULL REFERENCES page_loops(id),
      turn_index INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      scope TEXT NOT NULL,
      status TEXT CHECK(status IN ('active','revoked','expired')) NOT NULL DEFAULT 'active',
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS page_loop_receipts (
      id TEXT PRIMARY KEY,
      loop_id TEXT NOT NULL REFERENCES page_loops(id),
      turn_index INTEGER NOT NULL,
      sent_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS page_loop_checkpoints (
      id TEXT PRIMARY KEY,
      loop_id TEXT NOT NULL REFERENCES page_loops(id),
      epoch INTEGER NOT NULL,
      excerpt TEXT,
      turn_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_page_loops_status ON page_loops(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_page_loop_turns_loop ON page_loop_turns(loop_id, turn_index);
    CREATE INDEX IF NOT EXISTS idx_page_loop_leases_status ON page_loop_leases(status, heartbeat_at);
  `);

  // Cột mới cho bảng cũ, thêm chỉ khi chưa có (theo mẫu tasks columns).
  const outboxColumns = new Set(
    (db.query("PRAGMA table_info(injection_outbox)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!outboxColumns.has("loop_id")) db.exec(`ALTER TABLE injection_outbox ADD COLUMN loop_id TEXT`);
  const loopColumns = new Set(
    (db.query("PRAGMA table_info(page_loops)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!loopColumns.has("mode")) db.exec(`ALTER TABLE page_loops ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto'`);
  if (!loopColumns.has("chat_mode")) db.exec(`ALTER TABLE page_loops ADD COLUMN chat_mode TEXT NOT NULL DEFAULT 'retained'`);
  if (!loopColumns.has("epoch")) db.exec(`ALTER TABLE page_loops ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0`);
  if (!loopColumns.has("context_budget")) db.exec(`ALTER TABLE page_loops ADD COLUMN context_budget INTEGER NOT NULL DEFAULT 90000`);
  if (!loopColumns.has("context_used_estimate")) db.exec(`ALTER TABLE page_loops ADD COLUMN context_used_estimate INTEGER NOT NULL DEFAULT 0`);

  seedDefaultCustomCommands(db);

  return db;
}

function seedDefaultCustomCommands(db: Database): void {
  const defaults = [
    {
      id: "cmd-fb-sales",
      slash: "/fb-sales",
      icon: "🎯",
      category: "Facebook Marketing",
      title: "Thiết lập kịch bản bán hàng Facebook",
      description: "Xem và cập nhật kịch bản 6 giai đoạn, intent khách hàng và bình luận dạo",
      is_pinned: 1,
      prompt_template: `Hãy giúp tôi cấu hình và tối ưu kịch bản bán hàng trên Facebook:
1. Gọi tool 'fb_sales_get_playbook' để lấy toàn bộ kịch bản 6 giai đoạn (greeting, discovery, pitch, objection, closing, support), các ý định khách hàng (intents: pricing, features, objection_safety...) và bình luận dạo.
2. Dựa vào sản phẩm/dịch vụ của tôi: [Điền tên sản phẩm/dịch vụ của bạn tại đây]
3. Dùng tool 'fb_sales_update_stage' để cập nhật câu thoại mẫu phù hợp cho từng giai đoạn trong phễu bán hàng.
4. Dùng tool 'fb_sales_update_intent' để tối ưu câu giải đáp giá cả, tính năng và xử lý thắc mắc bảo mật.
5. Dùng tool 'fb_sales_update_comments' để cập nhật câu bình luận dạo tự nhiên khi đi tương tác feed.`
    },
    {
      id: "cmd-fb-listen",
      slash: "/fb-listen",
      icon: "💬",
      category: "Facebook Marketing",
      title: "Trực & Tự động trả lời Messenger",
      description: "Bật worker nền lắng nghe tin nhắn Messenger và trả lời theo kịch bản phễu",
      is_pinned: 1,
      prompt_template: `Hãy quản lý chế độ tự động lắng nghe và trực tin nhắn Messenger:
1. Gọi tool 'fb_messenger_listen_status' để kiểm tra xem daemon có đang lắng nghe tin nhắn hay không.
2. Nếu chưa bật hoặc cần đổi chu kỳ, gọi 'fb_messenger_listen_start' với interval_seconds=5 để bắt đầu tự động đọc tin nhắn đến, tra cứu kịch bản sales trong SQLite, trả lời khách và lưu lịch sử hội thoại.
3. Nếu tôi yêu cầu dừng trực, hãy gọi tool 'fb_messenger_listen_stop'.`
    },
    {
      id: "cmd-fb-feed",
      slash: "/fb-feed",
      icon: "📱",
      category: "Facebook Marketing",
      title: "Quét Feed & Tương tác bài viết FB",
      description: "Quét bảng tin và tự động thả like/love kèm bình luận dạo theo kịch bản",
      is_pinned: 1,
      prompt_template: `Hãy quét Bảng tin Facebook và tương tác bài viết an toàn:
1. Gọi tool 'fb_feed_scan' với limit=5 để quét các bài viết đang hiển thị trên feed (lấy post_key, tác giả, nội dung).
2. Phân loại nội dung từng bài viết (du lịch, kinh doanh, đời sống...).
3. Với mỗi bài phù hợp, gọi tool 'fb_feed_engage_post':
   - post_key: khóa định danh bài viết từ bước quét
   - reaction: 'like' hoặc 'love'
   - category: 'travel' / 'shop' / 'general' (để daemon tự bốc mẫu kịch bản) hoặc truyền custom_comment do bạn tự soạn ngắn gọn, lịch sự, đúng ngữ cảnh.
4. Báo cáo lại danh sách các bài viết đã tương tác thành công.`
    },
    {
      id: "cmd-fb-notif",
      slash: "/fb-notif",
      icon: "🔔",
      category: "Facebook Marketing",
      title: "Đọc thông báo & Trả lời bình luận",
      description: "Đọc danh sách thông báo Facebook, mở bài viết và trả lời comment của khách",
      is_pinned: 1,
      prompt_template: `Hãy kiểm tra thông báo Facebook mới nhất và phản hồi cho khách:
1. Gọi tool 'fb_notifications_read' với limit=5 để đọc danh sách thông báo gần đây.
2. Phân tích các thông báo liên quan đến khách bình luận hỏi mua hàng, tư vấn hoặc trao đổi trên bài viết.
3. Với thông báo cần trả lời, gọi tool 'fb_notification_open_and_reply':
   - notification_index: số thứ tự của thông báo (bắt đầu từ 0)
   - reply_text: câu trả lời lịch sự, đúng kịch bản giải đáp thắc mắc của khách.
4. Báo cáo kết quả thông báo nào đã được trả lời xong.`
    },
    {
      id: "cmd-fb-reply",
      slash: "/fb-reply",
      icon: "💬",
      category: "Facebook Marketing",
      title: "Tự động đọc & Trả lời bình luận bài viết FB",
      description: "Mở link bài viết, đọc bình luận, tự phục hồi nếu lệch link, like và tự suy luận trả lời theo ngữ cảnh",
      is_pinned: 1,
      prompt_template: `Hãy tự động mở bài viết Facebook, đọc tất cả bình luận, like và trả lời bình luận theo quy trình tự động hoàn toàn:
1. URL bài viết: [DÁN LINK BÀI VIẾT TẠI ĐÂY - ví dụ: https://www.facebook.com/share/p/17tu5cAG8h/]
2. Mở bài viết: Gọi tool 'browser_open' mở URL bài viết. (Lưu ý: Với bài viết trong nhóm, Facebook tự động chuyển hướng link chia sẻ sang đường dẫn nhóm /groups/.../permalink/..., đây là cùng một bài viết đích, hãy tiếp tục xử lý bình thường).
3. Đọc bình luận: Gọi tool 'fb_read_comments' với 'postUrl' là URL bài viết ở trên để lấy danh sách bình luận kèm likeIndex và replyIndex.
4. QUY TẮC TỰ PHỤC HỒI KHI LỆCH LINK (BẮT BUỘC):
   - Trong quá trình click nếu bị điều hướng nhầm sang trang cá nhân, bảng tin feed, hãy gọi 'browser_open' mở lại URL bài viết gốc và gọi 'fb_read_comments' với postUrl để lấy lại chỉ số mới nhất rồi tiếp tục.
5. Vòng lặp tương tác tự động 100% (TỰ ĐỘNG XÁC NHẬN, KHÔNG DỪNG CHỜ DUYỆT):
   - Thả cảm xúc: Nếu likeIndex khác null và isLiked=false, gọi 'browser_click' vào likeIndex để like bình luận.
   - Bấm trả lời: Gọi 'browser_click' vào replyIndex của bình luận.
   - Soạn và gửi nội dung: Dựa vào nội dung bình luận của người dùng, tự suy luận câu trả lời lịch sự, hữu ích và hợp ngữ cảnh, sau đó gọi 'browser_type' (targetIndex=-1 hoặc theo index ô nhập) với text và pressEnter=true (submit=true) để gửi đi luôn. Lưu ý: Facebook gửi bình luận bằng phím Enter, không có nút Gửi riêng, không cần tìm nút Gửi!
   - TỰ ĐỘNG GỬI TẤT CẢ: Tuyệt đối KHÔNG bỏ qua, KHÔNG dừng lại chờ người dùng xác nhận tay. Hãy tự động gửi và ghi nhận tiến độ.
   - Lặp lại cho các bình luận tiếp theo (hoặc bấm 'Xem thêm bình luận' nếu có).
6. Báo cáo tổng kết: Chụp ảnh màn hình bằng chứng và liệt kê danh sách các bình luận đã được like và trả lời thành công.`
    },
    {
      id: "cmd-fb-post-reply",
      slash: "/fb-post-reply",
      icon: "✍️",
      category: "Facebook Marketing",
      title: "Chăm sóc bình luận bài đăng Facebook",
      description: "Đọc tất cả bình luận trong một bài viết cụ thể và trả lời hàng loạt",
      is_pinned: 0,
      prompt_template: `Hãy chăm sóc và trả lời tất cả bình luận trong bài đăng Facebook:
1. Gọi tool 'fb_read_comments' với postUrl của bài viết để đọc các bình luận của khách.
2. Gọi tool 'fb_reply_start' với postUrl (mode='draft' để duyệt trước câu trả lời hoặc mode='auto' để tự động gửi).
3. Đọc từng bình luận qua 'fb_reply_next', tham khảo kịch bản bán hàng qua 'fb_sales_get_playbook' để soạn câu trả lời hấp dẫn.
4. Gọi 'fb_reply_mark_replied' để ghi nhận tiến độ và tương tác gửi câu trả lời.`
    },
    {
      id: "cmd-fb-media",
      slash: "/fb-media",
      icon: "🎬",
      category: "Facebook Marketing",
      title: "Đăng Video & Ảnh lên Facebook (Cá nhân, Nhóm, Fanpage)",
      description: "Đăng video/ảnh hoặc quét cả thư mục video thành từng bài viết riêng rẽ, tích hợp Muse AI",
      is_pinned: 1,
      prompt_template: `Hãy giúp tôi đăng bài viết kèm video/hình ảnh lên Facebook:
1. Lựa chọn đích đăng bài (targetType):
   - 'profile': Trang cá nhân (URL mặc định https://www.facebook.com/)
   - 'group': Nhóm Facebook (URL dạng https://www.facebook.com/groups/<group_id>)
   - 'page': Fanpage Facebook (URL dạng https://www.facebook.com/<page_name>)
2. Chọn hình thức nạp nội dung:
   - Cách 1: Đăng 1 video/ảnh ngay lập tức -> Dùng tool 'fb_post_media' với mediaPath và caption.
   - Cách 2: Quét thư mục video trên máy tính đăng lần lượt -> Dùng tool 'fb_queue_media_folder' với folderPath (vd: C:/videos), targetType, targetUrl và intervalMinutes (mặc định 3 phút/bài).
   - Cách 3: Nạp mảng danh sách bài viết -> Dùng tool 'fb_queue_media_list' với mảng items cụ thể.
   - Cách 4: Tạo video qua Muse AI rồi đăng -> Dùng tool 'fb_queue_muse_video' với prompt yêu cầu Muse tạo video, sau đó tải về và lập lịch đăng.
3. Kiểm tra tiến độ hàng đợi qua tool 'fb_media_list_queue'.`
    }
  ];

  const now = Date.now();
  const insertStmt = db.prepare(`
    INSERT INTO custom_commands (id, slash, icon, category, title, description, prompt_template, is_pinned, usage_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(slash) DO UPDATE SET
      icon = excluded.icon,
      category = excluded.category,
      title = excluded.title,
      description = excluded.description,
      prompt_template = excluded.prompt_template,
      is_pinned = excluded.is_pinned,
      updated_at = excluded.updated_at
  `);

  for (const cmd of defaults) {
    insertStmt.run(cmd.id, cmd.slash, cmd.icon, cmd.category, cmd.title, cmd.description, cmd.prompt_template, cmd.is_pinned, now, now);
  }
}

let sharedDb: Database | null = null;

export function getDatabase(dbPath: string = getDefaultDatabasePath()): Database {
  if (!sharedDb) {
    sharedDb = initDatabase(dbPath);
  }
  return sharedDb;
}
