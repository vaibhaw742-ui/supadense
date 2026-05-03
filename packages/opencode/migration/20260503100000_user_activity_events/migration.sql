CREATE TABLE IF NOT EXISTS user_activity_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_uae_user_id ON user_activity_events(user_id);
CREATE INDEX IF NOT EXISTS idx_uae_created_at ON user_activity_events(created_at);
CREATE INDEX IF NOT EXISTS idx_uae_event_type ON user_activity_events(event_type);
