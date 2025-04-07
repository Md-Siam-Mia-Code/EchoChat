-- Drop existing tables if recreating (use with caution)
DROP TABLE IF EXISTS blocks;
DROP TABLE IF EXISTS conversation_participants;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS app_config;
DROP TABLE IF EXISTS users;

-- Stores application-level configuration, like admin status and master password hash
CREATE TABLE app_config (
    config_key TEXT PRIMARY KEY,
    config_value TEXT NOT NULL
);

-- Stores user accounts
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT 0, -- 0 for user, 1 for admin
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Stores conversations (both 1-to-1 and groups)
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    is_group BOOLEAN NOT NULL DEFAULT 0,
    group_name TEXT, -- Only for groups
    creator_id INTEGER, -- User who created the group/conversation
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity_ts DATETIME DEFAULT CURRENT_TIMESTAMP, -- Timestamp of the last message or creation
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL -- Allow creator deletion
);

-- Links users to conversations (many-to-many relationship)
CREATE TABLE conversation_participants (
    conversation_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE, -- Delete participant entry if conversation is deleted
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE -- Delete participant entry if user is deleted
);

-- Stores individual messages
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Stores user blocking information
CREATE TABLE blocks (
    blocker_id INTEGER NOT NULL, -- User doing the blocking
    blocked_id INTEGER NOT NULL, -- User being blocked
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (blocker_id, blocked_id),
    FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_conversations_last_activity ON conversations (last_activity_ts DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_ts ON messages (conversation_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked_id);

-- Initial configuration state (admin not created yet)
INSERT INTO app_config (config_key, config_value) VALUES ('admin_created', 'false');
-- Add master_password_hash row during onboarding