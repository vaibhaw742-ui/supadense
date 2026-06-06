-- GitHub OAuth connection per user
ALTER TABLE auth_users ADD COLUMN github_access_token TEXT;
ALTER TABLE auth_users ADD COLUMN github_login TEXT;
