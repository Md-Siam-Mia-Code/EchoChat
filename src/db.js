// src/db.js - Optional helper functions for D1 interactions

/**
 * Fetches a specific configuration value from the app_config table.
 * @param {D1Database} db - The D1 database binding.
 * @param {string} key - The config_key to fetch.
 * @returns {Promise<string|null>} The config_value or null if not found/error.
 */
export async function getAppConfig(db, key) {
    if (!db) { console.error("DB binding missing in getAppConfig"); return null; }
    try {
        const stmt = db.prepare('SELECT config_value FROM app_config WHERE config_key = ?1');
        const result = await stmt.bind(key).first('config_value');
        return result ?? null; // Return null explicitly if undefined/null
    } catch (e) {
        console.error(`Error getting app config for key '${key}':`, e);
        return null;
    }
}

/**
 * Sets or updates a configuration value in the app_config table.
 * @param {D1Database} db - The D1 database binding.
 * @param {string} key - The config_key to set.
 * @param {string} value - The config_value to store.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
export async function setAppConfig(db, key, value) {
    if (!db) { console.error("DB binding missing in setAppConfig"); return false; }
    try {
        const stmt = db.prepare('INSERT OR REPLACE INTO app_config (config_key, config_value) VALUES (?1, ?2)');
        const { success } = await stmt.bind(key, value).run();
        return success;
    } catch (e) {
        console.error(`Error setting app config for key '${key}':`, e);
        return false;
    }
}

/**
 * Checks if a user is blocked by another user.
 * @param {D1Database} db
 * @param {number} potentialBlockerId - The ID of the user who might have blocked someone.
 * @param {number} potentialBlockedId - The ID of the user who might be blocked.
 * @returns {Promise<boolean>} True if potentialBlockedId is blocked by potentialBlockerId.
 */
export async function isBlocked(db, potentialBlockerId, potentialBlockedId) {
    if (!db || !potentialBlockerId || !potentialBlockedId) return false;
    try {
        const stmt = db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ?1 AND blocked_id = ?2 LIMIT 1');
        const result = await stmt.bind(potentialBlockerId, potentialBlockedId).first();
        return !!result; // True if a row exists, false otherwise
    } catch (e) {
        console.error(`Error checking block status between ${potentialBlockerId} and ${potentialBlockedId}:`, e);
        return false; // Fail safe (assume not blocked on error)
    }
}

/**
 * Retrieves participants of a conversation, potentially excluding one user.
 * @param {D1Database} db
 * @param {number} conversationId
 * @param {number} [excludeUserId] - Optional user ID to exclude from the list.
 * @returns {Promise<Array<number>>} List of participant user IDs.
 */
export async function getConversationParticipants(db, conversationId, excludeUserId = null) {
    if (!db || !conversationId) return [];
    try {
        let query = 'SELECT user_id FROM conversation_participants WHERE conversation_id = ?1';
        const params = [conversationId];
        if (excludeUserId !== null && typeof excludeUserId === 'number') {
            query += ' AND user_id != ?2';
            params.push(excludeUserId);
        }
        const stmt = db.prepare(query);
        const { results } = await stmt.bind(...params).all();
        return results ? results.map(row => row.user_id) : [];
    } catch (e) {
        console.error(`Error getting participants for conversation ${conversationId}:`, e);
        return [];
    }
}