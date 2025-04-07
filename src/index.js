// src/index.js (Combined API/WS/Static Serving Worker - CORRECTED DO Notification)

import { ChatCoordinatorDO } from './durableObjects.js'; // Assuming ./durableObjects.js exports ChatCoordinatorDO
import { jsonResponse, handleOptions, sha256, validateInput } from './utils.js'; // Assuming ./utils.js exists
import { getAppConfig, setAppConfig, isBlocked, getConversationParticipants } from './db.js'; // Assuming ./db.js exists
import { generateSessionToken, verifySessionToken, requireAuth, requireAdminAuth, verifyMasterPassword } from './auth.js'; // Assuming ./auth.js exists

// Import the kv-asset-handler components
import { getAssetFromKV, mapRequestToAsset, NotFoundError, MethodNotAllowedError } from '@cloudflare/kv-asset-handler';

export default {
	/**
	 * Main fetch handler: Routes API/WS requests first, then serves static assets.
	 */
	async fetch(request, env, ctx) {
		// --- Environment Binding Checks ---
		if (!env.DB) return jsonResponse({ error: 'Server configuration error: Database binding missing.' }, 500);
		if (!env.CHAT_DO) return jsonResponse({ error: 'Server configuration error: Chat service unavailable.' }, 500);
		if (!env.__STATIC_CONTENT) console.warn("Static content binding '__STATIC_CONTENT' missing. Asset serving may fail.");

		const url = new URL(request.url);

		try {
			// --- CORS Preflight ---
			if (request.method === 'OPTIONS') {
				return handleOptions(request);
			}

			// --- WebSocket Upgrade ---
			if (url.pathname === '/ws') {
				console.log("Worker: Request for /ws endpoint.");
				// Ensure the Durable Object binding is available
				if (!env.CHAT_DO) {
					console.error("Worker: CHAT_DO binding is missing!");
					return new Response("WebSocket service unavailable", { status: 500 });
				}
				let doId = env.CHAT_DO.idFromName("global-chat-coordinator");
				let chatDO = env.CHAT_DO.get(doId);
				console.log(`Worker: Forwarding WebSocket request to DO instance ${doId.toString()}.`);
				return chatDO.fetch(request); // Delegate to the DO's fetch handler
			}

			// --- Internal DO Notification Route Handling ---
			// *** REMOVED THIS ENTIRE BLOCK - Worker will call DO method directly ***
			// if (url.pathname.startsWith('/internal/')) { ... }

			// --- API Routes ---
			if (url.pathname.startsWith('/api/')) {
				// Pass env.CHAT_DO to the API handler so it can get the stub
				return this.handleApiRequest(request, env, ctx, url);
			}

			// --- Static Asset Serving (Catch-all for GET requests not matching above) ---
			if (request.method === 'GET') {
				console.log(`Worker: Attempting to serve static asset for: ${url.pathname}`);
				const manifest = env.__STATIC_CONTENT_MANIFEST ? JSON.parse(env.__STATIC_CONTENT_MANIFEST) : {};
				return getAssetFromKV(
					{ request, waitUntil: (promise) => ctx.waitUntil(promise) },
					{
						ASSET_NAMESPACE: env.__STATIC_CONTENT,
						ASSET_MANIFEST: manifest,
						mapRequestToAsset: mapRequestToAsset,
						cacheControl: { browserTTL: null, edgeTTL: 2 * 60 * 60 * 24 }
					}
				);
			}

			// --- Fallback for unmatched routes/methods ---
			console.log("Worker: Unmatched route/method (after static check):", request.method, url.pathname);
			return jsonResponse({ error: 'Not Found' }, 404);

		} catch (error) {
			// Handle errors from kv-asset-handler (NotFound, MethodNotAllowed)
			if (error instanceof NotFoundError) {
				console.log(`Static asset not found for ${url.pathname}, attempting SPA fallback.`);
				if (!url.pathname.includes('.')) {
					try {
						console.log(`SPA fallback: Serving index.html for ${url.pathname}`);
						const manifest = env.__STATIC_CONTENT_MANIFEST ? JSON.parse(env.__STATIC_CONTENT_MANIFEST) : {};
						return getAssetFromKV(
							{ request: new Request(url.origin + '/index.html', request), waitUntil: ctx.waitUntil },
							{ ASSET_NAMESPACE: env.__STATIC_CONTENT, ASSET_MANIFEST: manifest }
						);
					} catch (spaError) {
						console.error(`SPA fallback failed for ${url.pathname}:`, spaError);
						return new Response('Not Found (SPA Fallback Failed)', { status: 404, headers: { 'Content-Type': 'text/plain' } });
					}
				} else {
					console.log(`Asset with extension not found: ${url.pathname}`);
					return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
				}
			} else if (error instanceof MethodNotAllowedError) {
				console.log(`Method not allowed for ${url.pathname}, returning 405.`);
				return new Response('Method Not Allowed', { status: 405, headers: { 'Content-Type': 'text/plain', 'Allow': 'GET' } });
			} else {
				console.error(`Worker fetch top-level error:`, error, error.stack);
				return jsonResponse({ error: 'Internal Server Error' }, 500);
			}
		}
	}, // End main fetch

	/**
	 * Handles routing for /api/* requests.
	 * Now requires `env.CHAT_DO` to be available.
	 */
	async handleApiRequest(request, env, ctx, url) {
		const path = url.pathname.replace('/api/', '');
		const pathSegments = path.split('/').filter(Boolean);
		const method = request.method;

		console.log(`API Request: ${method} /api/${path}`);

		try {
			// --- Get DO Stub ---
			// We need the stub in multiple API handlers now
			let chatDOStub;
			if (env.CHAT_DO) {
				let doId = env.CHAT_DO.idFromName("global-chat-coordinator");
				chatDOStub = env.CHAT_DO.get(doId);
			} else {
				console.error("API Handler: CHAT_DO binding is missing!");
				// Allow read-only routes to proceed, but block actions requiring DO notification
			}

			// --- Unprotected Routes --- (Remain the same)
			// GET /api/setup/status
			if (method === 'GET' && path === 'setup/status') {
				const adminCreated = await getAppConfig(env.DB, 'admin_created');
				return jsonResponse({ adminExists: adminCreated === 'true' });
			}

			// POST /api/setup/admin
			if (method === 'POST' && path === 'setup/admin') {
				const adminCreated = await getAppConfig(env.DB, 'admin_created');
				if (adminCreated === 'true') return jsonResponse({ error: 'Admin account already exists.' }, 409);
				const body = await request.json();
				const validationError = validateInput(body, ['username', 'password', 'masterPassword']);
				if (validationError) return jsonResponse({ error: validationError }, 400);
				const passwordHash = await sha256(body.password);
				const masterPasswordHash = await sha256(body.masterPassword);
				const results = await env.DB.batch([
					env.DB.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?1, ?2, 1)').bind(body.username, passwordHash),
					env.DB.prepare('INSERT OR REPLACE INTO app_config (config_key, config_value) VALUES (?1, ?2)').bind('master_password_hash', masterPasswordHash),
					env.DB.prepare('INSERT OR REPLACE INTO app_config (config_key, config_value) VALUES (?1, ?2)').bind('admin_created', 'true')
				]);
				if (results.every(r => r.success)) {
					console.log("ADMIN CREATED SUCCESSFULLY:", body.username);
					return jsonResponse({ success: true, message: 'Admin account created successfully.' }, 201);
				} else { throw new Error("Failed to create admin user transactionally."); }
			}

			// POST /api/auth/login
			if (method === 'POST' && path === 'auth/login') {
				const body = await request.json();
				const validationError = validateInput(body, ['username', 'password']);
				if (validationError) return jsonResponse({ error: validationError }, 400);
				const user = await env.DB.prepare('SELECT id, password_hash, is_admin FROM users WHERE username = ?1').bind(body.username).first();
				if (!user) return jsonResponse({ error: 'Invalid username or password.' }, 401);
				const passwordHash = await sha256(body.password);
				if (passwordHash !== user.password_hash) return jsonResponse({ error: 'Invalid username or password.' }, 401);
				const token = generateSessionToken(user.id);
				return jsonResponse({ success: true, token: token, user: { id: user.id, username: body.username, isAdmin: !!user.is_admin } });
			}

			// POST /api/auth/admin/login
			if (method === 'POST' && path === 'auth/admin/login') {
				const body = await request.json();
				if (!body.masterPassword) return jsonResponse({ error: 'Master password required.' }, 400);
				const isValid = await verifyMasterPassword(env.DB, body.masterPassword);
				if (!isValid) return jsonResponse({ error: 'Invalid master password.' }, 401);
				const adminUser = await env.DB.prepare('SELECT id, username FROM users WHERE is_admin = 1 LIMIT 1').first();
				if (!adminUser) return jsonResponse({ error: 'Admin account not found.' }, 500);
				const token = generateSessionToken(adminUser.id);
				return jsonResponse({ success: true, token: token, user: { id: adminUser.id, username: adminUser.username, isAdmin: true } });
			}

			// POST /api/users (Registration)
			if (method === 'POST' && path === 'users') {
				const adminCreated = await getAppConfig(env.DB, 'admin_created');
				if (adminCreated !== 'true') return jsonResponse({ error: 'User registration not available yet.' }, 403);
				const body = await request.json();
				const validationError = validateInput(body, ['username', 'password']);
				if (validationError) return jsonResponse({ error: validationError }, 400);
				try {
					const passwordHash = await sha256(body.password);
					const { success, meta } = await env.DB.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?1, ?2, 0)')
						.bind(body.username, passwordHash).run();
					if (success) { return jsonResponse({ success: true, userId: meta.last_row_id, username: body.username }, 201); }
					else { throw new Error("DB Insert failed."); }
				} catch (e) {
					if (e.message?.includes("UNIQUE constraint failed: users.username") || e.cause?.message?.includes("UNIQUE")) {
						return jsonResponse({ error: 'Username already taken.' }, 409);
					} throw e;
				}
			}

			// --- Protected Routes ---
			let response = null; // To hold the response from the handlers

			// GET /api/users
			if (method === 'GET' && path === 'users') {
				response = await requireAuth(request, env, ctx, async (req) => {
					// Code remains the same
					const requestingUserId = req.userId;
					const query = `
                        SELECT u.id, u.username
                        FROM users u
                        WHERE u.id != ?1
                          AND NOT EXISTS (SELECT 1 FROM blocks blocker WHERE blocker.blocker_id = u.id AND blocker.blocked_id = ?1) -- They haven't blocked me
                          AND NOT EXISTS (SELECT 1 FROM blocks blocked WHERE blocked.blocker_id = ?1 AND blocked.blocked_id = u.id) -- I haven't blocked them
                        ORDER BY u.username ASC;
                    `;
					const { results } = await env.DB.prepare(query).bind(requestingUserId).all();
					return jsonResponse(results || []);
				});
			}
			// GET /api/conversations
			else if (method === 'GET' && path === 'conversations') {
				response = await requireAuth(request, env, ctx, async (req) => {
					// Code remains the same
					const userId = req.userId;
					const query = `
                        SELECT
                            c.id, c.is_group, c.group_name, c.last_activity_ts,
                            m.content as last_message_content,
                            m.timestamp as last_message_ts,
                            sender.username as last_message_sender,
                            CASE WHEN c.is_group = 0 THEN partner.username ELSE NULL END as partner_username,
                            CASE WHEN c.is_group = 0 THEN partner.id ELSE NULL END as partner_id
                        FROM conversations c
                        JOIN conversation_participants cp ON c.id = cp.conversation_id
                        LEFT JOIN messages m ON m.id = (SELECT id FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1)
                        LEFT JOIN users sender ON m.sender_id = sender.id
                        LEFT JOIN conversation_participants cp_partner ON c.id = cp_partner.conversation_id AND cp_partner.user_id != ?1
                        LEFT JOIN users partner ON cp_partner.user_id = partner.id AND c.is_group = 0
                        WHERE cp.user_id = ?1
                          AND (c.is_group = 1 OR NOT EXISTS (
                              SELECT 1 FROM blocks b
                              WHERE b.blocker_id = cp_partner.user_id AND b.blocked_id = cp.user_id
                          ))
                        GROUP BY c.id
                        ORDER BY c.last_activity_ts DESC;
                    `;
					const { results } = await env.DB.prepare(query).bind(userId).all();
					return jsonResponse(results || []);
				});
			}
			// POST /api/conversations
			else if (method === 'POST' && path === 'conversations') {
				response = await requireAuth(request, env, ctx, async (req) => {
					// Code remains the same
					const userId = req.userId;
					const body = await req.json();
					const partnerId = parseInt(body.partnerId, 10);
					if (isNaN(partnerId) || partnerId === userId) return jsonResponse({ error: 'Invalid partner ID.' }, 400);
					const partnerExists = await env.DB.prepare("SELECT id from USERS where id = ?1").bind(partnerId).first();
					if (!partnerExists) return jsonResponse({ error: "Partner user not found" }, 404);
					const existingConv = await env.DB.prepare(`
                           SELECT cp1.conversation_id FROM conversation_participants cp1 JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id JOIN conversations c ON cp1.conversation_id = c.id
                           WHERE cp1.user_id = ?1 AND cp2.user_id = ?2 AND c.is_group = 0 LIMIT 1
                       `).bind(userId, partnerId).first('conversation_id');
					if (existingConv) return jsonResponse({ success: true, conversationId: existingConv, existed: true });
					if (await isBlocked(env.DB, partnerId, userId)) return jsonResponse({ error: 'Cannot start conversation: this user has blocked you.' }, 403);
					if (await isBlocked(env.DB, userId, partnerId)) return jsonResponse({ error: 'You have blocked this user. Unblock them to start a conversation.' }, 403);
					let newConversationId = null;
					try {
						const now = new Date().toISOString();
						const convInsertResult = await env.DB.prepare('INSERT INTO conversations (is_group, creator_id, last_activity_ts) VALUES (0, ?1, ?2) RETURNING id').bind(userId, now).first();
						if (!convInsertResult || !convInsertResult.id) throw new Error("Failed to create conversation.");
						newConversationId = convInsertResult.id;
						const participantInsert = await env.DB.batch([
							env.DB.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?1, ?2)').bind(newConversationId, userId),
							env.DB.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?1, ?2)').bind(newConversationId, partnerId)
						]);
						if (!participantInsert.every(r => r.success)) { throw new Error("Failed to add participants."); }
						return jsonResponse({ success: true, conversationId: newConversationId, existed: false }, 201);
					} catch (e) {
						console.error("Error creating 1-to-1 conversation:", e);
						if (newConversationId) {
							await env.DB.prepare("DELETE FROM conversation_participants WHERE conversation_id = ?1").bind(newConversationId).run().catch(err => console.error("Cleanup failed:", err));
							await env.DB.prepare("DELETE FROM conversations WHERE id = ?1").bind(newConversationId).run().catch(err => console.error("Cleanup failed:", err));
						}
						throw new Error("Failed to start conversation.");
					}
				});
			}
			// GET /api/conversations/:id/messages
			else if (method === 'GET' && pathSegments.length === 3 && pathSegments[0] === 'conversations' && pathSegments[2] === 'messages') {
				response = await requireAuth(request, env, ctx, async (req) => {
					// Code remains the same
					const conversationId = parseInt(pathSegments[1], 10);
					if (isNaN(conversationId)) return jsonResponse({ error: 'Invalid conversation ID.' }, 400);
					const userId = req.userId;
					const participantCheck = await env.DB.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2').bind(conversationId, userId).first();
					if (!participantCheck) return jsonResponse({ error: 'Forbidden: You are not part of this conversation.' }, 403);
					const convInfo = await env.DB.prepare('SELECT is_group FROM conversations WHERE id = ?1').bind(conversationId).first();
					if (convInfo && !convInfo.is_group) {
						const participants = await getConversationParticipants(env.DB, conversationId);
						const partnerId = participants.find(pId => pId !== userId);
						if (partnerId && await isBlocked(env.DB, partnerId, userId)) {
							return jsonResponse({ error: 'Forbidden: Cannot access messages, you are blocked by the other user.' }, 403);
						}
					}
					const limit = 50;
					const query = `
                           SELECT m.id, m.content, m.timestamp, m.sender_id, u.username as sender_username, m.conversation_id
                           FROM messages m JOIN users u ON m.sender_id = u.id
                           WHERE m.conversation_id = ?1 ORDER BY m.timestamp ASC LIMIT ?2;
                       `;
					const { results } = await env.DB.prepare(query).bind(conversationId, limit).all();
					return jsonResponse(results || []);
				});
			}
			// *** CORRECTED: POST /api/conversations/:id/messages ***
			else if (method === 'POST' && pathSegments.length === 3 && pathSegments[0] === 'conversations' && pathSegments[2] === 'messages') {
				const conversationId = parseInt(pathSegments[1], 10);
				if (isNaN(conversationId)) return jsonResponse({ error: 'Invalid conversation ID.' }, 400);

				response = await requireAuth(request, env, ctx, async (req) => {
					const userId = req.userId; // Sender ID
					const body = await req.json();
					const content = body.content?.trim();
					if (!content) return jsonResponse({ error: 'Message content cannot be empty.' }, 400);

					// Check participation & blocks (same as before)
					const participantCheck = await env.DB.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2').bind(conversationId, userId).first();
					if (!participantCheck) return jsonResponse({ error: 'Forbidden: You are not part of this conversation.' }, 403);
					const convInfo = await env.DB.prepare('SELECT id, is_group FROM conversations WHERE id = ?1').bind(conversationId).first();
					if (!convInfo) return jsonResponse({ error: 'Conversation not found.' }, 404);
					if (!convInfo.is_group) {
						const participants = await getConversationParticipants(env.DB, conversationId);
						const partnerId = participants.find(pId => pId !== userId);
						if (partnerId) {
							if (await isBlocked(env.DB, userId, partnerId)) return jsonResponse({ error: 'You have blocked this user.' }, 403);
							if (await isBlocked(env.DB, partnerId, userId)) return jsonResponse({ error: 'Cannot send message: this user has blocked you.' }, 403);
						}
					}

					// Insert message and update conversation timestamp (same as before)
					const now = new Date().toISOString();
					const msgInsertResult = await env.DB.prepare('INSERT INTO messages (conversation_id, sender_id, content) VALUES (?1, ?2, ?3) RETURNING id').bind(conversationId, userId, content).first();
					const convUpdateResult = await env.DB.prepare('UPDATE conversations SET last_activity_ts = ?1 WHERE id = ?2').bind(now, conversationId).run();

					if (msgInsertResult && msgInsertResult.id && convUpdateResult.success) {
						const newMessageId = msgInsertResult.id;
						// Fetch the full message details to broadcast (same as before)
						const newMessage = await env.DB.prepare(`
                            SELECT m.id, m.content, m.timestamp, m.sender_id, u.username as sender_username, m.conversation_id, c.is_group
                            FROM messages m
                            JOIN users u ON m.sender_id = u.id
                            JOIN conversations c ON m.conversation_id = c.id
                            WHERE m.id = ?1
                        `).bind(newMessageId).first();

						if (newMessage) {
							// *** CHANGE: Call DO method directly ***
							if (chatDOStub) {
								console.log(`Worker: Notifying DO directly for new message ${newMessageId}`);
								// Use ctx.waitUntil to ensure the call completes after the response
								ctx.waitUntil(
									// Assuming your DO has a method like this:
									chatDOStub.notifyNewMessage(newMessage, userId)
										.catch(err => console.error("Worker: DO notifyNewMessage failed:", err))
								);
							} else {
								console.error("Worker: Cannot notify DO, stub is missing!");
							}
						} else { console.error(`Worker: Failed to fetch newly inserted message ${newMessageId}`); }

						// Return success to the sending client immediately
						return jsonResponse({ success: true, messageId: newMessageId }, 201);
					} else {
						console.error("Message send failed:", msgInsertResult, convUpdateResult);
						throw new Error("Failed to send message or update conversation.");
					}
				});
			}
			// DELETE /api/messages/:id
			else if (method === 'DELETE' && pathSegments.length === 2 && pathSegments[0] === 'messages') {
				response = await requireAuth(request, env, ctx, async (req) => {
					// Code remains the same
					const messageId = parseInt(pathSegments[1], 10);
					if (isNaN(messageId)) return jsonResponse({ error: 'Invalid message ID.' }, 400);
					const requestingUserId = req.userId;
					const originalMessage = await env.DB.prepare('SELECT sender_id FROM messages WHERE id = ?1').bind(messageId).first();
					if (!originalMessage) return jsonResponse({ success: false, error: 'Message not found.' }, 404);
					if (originalMessage.sender_id !== requestingUserId) return jsonResponse({ success: false, error: 'Forbidden: You can only delete your own messages.' }, 403);
					const { success, meta } = await env.DB.prepare('DELETE FROM messages WHERE id = ?1').bind(messageId).run();
					if (success && meta.changes > 0) { return jsonResponse({ success: true, message: 'Message deleted successfully.' }); }
					else if (success && meta.changes === 0) { return jsonResponse({ success: false, error: 'Message not found or already deleted.' }, 404); }
					else { throw new Error("Database delete operation failed."); }
				});
			}
			// POST /api/groups
			else if (method === 'POST' && path === 'groups') {
				response = await requireAuth(request, env, ctx, async (req) => {
					// Code needs update for direct DO call
					const userId = req.userId;
					const body = await req.json();
					const groupName = body.name?.trim();
					const memberIdsInput = body.members || [];

					// Filter member IDs asynchronously
					const potentialMemberIds = [...new Set(memberIdsInput.map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id !== userId))];
					const memberIds = [];
					for (const id of potentialMemberIds) {
						if (!(await isBlocked(env.DB, userId, id)) && !(await isBlocked(env.DB, id, userId))) {
							memberIds.push(id);
						}
					}

					if (!groupName) return jsonResponse({ error: 'Group name is required.' }, 400);
					if (memberIds.length === 0) return jsonResponse({ error: 'Group must have at least one other valid (unblocked) member.' }, 400);
					let newConversationId = null;
					try {
						const now = new Date().toISOString();
						const convInsertResult = await env.DB.prepare('INSERT INTO conversations (is_group, group_name, creator_id, last_activity_ts) VALUES (1, ?1, ?2, ?3) RETURNING id').bind(groupName, userId, now).first();
						if (!convInsertResult || !convInsertResult.id) throw new Error("Failed to create group conversation.");
						newConversationId = convInsertResult.id;
						const participantStmts = [env.DB.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?1, ?2)').bind(newConversationId, userId)];
						memberIds.forEach(memberId => { participantStmts.push(env.DB.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?1, ?2)').bind(newConversationId, memberId)); });
						const batchResult = await env.DB.batch(participantStmts);
						if (!batchResult.every(r => r.success)) { throw new Error("Failed to add all group participants."); }

						// *** CHANGE: Call DO method directly ***
						if (chatDOStub) {
							console.log(`Worker: Notifying DO directly for new group ${newConversationId}`);
							memberIds.forEach(memberId => {
								ctx.waitUntil(
									// Assuming DO method: notifyGroupAdd(conversationId, addedUserId, groupName)
									chatDOStub.notifyGroupAdd(newConversationId, memberId, groupName)
										.catch(err => console.error("Worker: DO notifyGroupAdd failed:", err))
								);
							});
						} else { console.error("Worker: Cannot notify DO for group add, stub is missing!"); }

						return jsonResponse({ success: true, conversationId: newConversationId, name: groupName }, 201);
					} catch (e) {
						console.error("Error creating group:", e);
						if (newConversationId) {
							await env.DB.prepare("DELETE FROM conversation_participants WHERE conversation_id = ?1").bind(newConversationId).run().catch(err => console.error("Cleanup failed:", err));
							await env.DB.prepare("DELETE FROM conversations WHERE id = ?1").bind(newConversationId).run().catch(err => console.error("Cleanup failed:", err));
						}
						throw new Error("Failed to create group.");
					}
				});
			}
			// POST /api/groups/:id/participants - Needs update if implemented
			else if (method === 'POST' && pathSegments.length === 3 && pathSegments[0] === 'groups' && pathSegments[2] === 'participants') {
				return jsonResponse({ error: 'Add group member not implemented yet.' }, 501);
			}
			// DELETE /api/groups/:id/participants/:userId - Needs update if implemented
			else if (method === 'DELETE' && pathSegments.length === 4 && pathSegments[0] === 'groups' && pathSegments[2] === 'participants') {
				return jsonResponse({ error: 'Remove group member not implemented yet.' }, 501);
			}
			// DELETE /api/groups/:id - Needs update if implemented
			else if (method === 'DELETE' && pathSegments.length === 2 && pathSegments[0] === 'groups') {
				return jsonResponse({ error: 'Delete group not implemented yet.' }, 501);
			}
			// GET /api/blocks
			else if (method === 'GET' && path === 'blocks') {
				response = await requireAuth(request, env, ctx, async (req) => {
					// Code remains the same
					const userId = req.userId;
					const { results } = await env.DB.prepare(`SELECT u.id, u.username FROM blocks b JOIN users u ON b.blocked_id = u.id WHERE b.blocker_id = ?1 ORDER BY u.username ASC`).bind(userId).all();
					return jsonResponse(results || []);
				});
			}
			// POST /api/blocks
			else if (method === 'POST' && path === 'blocks') {
				response = await requireAuth(request, env, ctx, async (req) => {
					// Code needs update for direct DO call
					const blockerId = req.userId;
					const body = await req.json();
					const blockedId = parseInt(body.userId, 10);
					if (isNaN(blockedId) || blockerId === blockedId) return jsonResponse({ error: 'Invalid user ID to block.' }, 400);
					const userExists = await env.DB.prepare('SELECT id FROM users WHERE id = ?1').bind(blockedId).first();
					if (!userExists) return jsonResponse({ error: 'User to block not found.' }, 404);
					try {
						const { success } = await env.DB.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?1, ?2)').bind(blockerId, blockedId).run();
						if (success) {
							// *** CHANGE: Call DO method directly ***
							if (chatDOStub) {
								console.log(`Worker: Notifying DO directly for block: ${blockerId} blocked ${blockedId}`);
								ctx.waitUntil(
									// Assuming DO method: notifyBlock(blockerId, blockedId)
									chatDOStub.notifyBlock(blockerId, blockedId)
										.catch(err => console.error("Worker: DO notifyBlock failed:", err))
								);
							} else { console.error("Worker: Cannot notify DO for block, stub is missing!"); }
							return jsonResponse({ success: true }, 201);
						} else { throw new Error("DB insert failed"); }
					} catch (e) { console.error("Error blocking user:", e); throw new Error('Failed to block user.'); }
				});
			}
			// DELETE /api/blocks/:userId
			else if (method === 'DELETE' && pathSegments.length === 2 && pathSegments[0] === 'blocks') {
				response = await requireAuth(request, env, ctx, async (req) => {
					// Code needs update for direct DO call
					const blockedIdToUnblock = parseInt(pathSegments[1], 10);
					if (isNaN(blockedIdToUnblock)) return jsonResponse({ error: 'Invalid user ID to unblock.' }, 400);
					const blockerId = req.userId;
					const { success, meta } = await env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ?1 AND blocked_id = ?2').bind(blockerId, blockedIdToUnblock).run();
					if (success && meta.changes >= 0) {
						// *** CHANGE: Call DO method directly ***
						if (chatDOStub) {
							console.log(`Worker: Notifying DO directly for unblock: ${blockerId} unblocked ${blockedIdToUnblock}`);
							ctx.waitUntil(
								// Assuming DO method: notifyUnblock(blockerId, unblockedId)
								chatDOStub.notifyUnblock(blockerId, blockedIdToUnblock)
									.catch(err => console.error("Worker: DO notifyUnblock failed:", err))
							);
						} else { console.error("Worker: Cannot notify DO for unblock, stub is missing!"); }
						return jsonResponse({ success: true, message: meta.changes > 0 ? "User unblocked." : "User was not blocked." });
					} else { throw new Error("Failed to unblock user."); }
				});
			}
			// --- Admin Routes --- (Remain the same)
			else if (path.startsWith('admin/')) {
				// GET /api/admin/stats
				if (method === 'GET' && path === 'admin/stats') {
					response = await requireAdminAuth(request, env, ctx, async (req) => {
						const userCount = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first('count');
						const messageCount = await env.DB.prepare('SELECT COUNT(*) as count FROM messages').first('count');
						const groupCount = await env.DB.prepare('SELECT COUNT(*) as count FROM conversations WHERE is_group = 1').first('count');
						return jsonResponse({ userCount: userCount || 0, messageCount: messageCount || 0, groupCount: groupCount || 0, activeUsers: 0 }); // Placeholder for active
					});
				}
				// GET /api/admin/users
				else if (method === 'GET' && path === 'admin/users') {
					response = await requireAdminAuth(request, env, ctx, async (req) => {
						const { results } = await env.DB.prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY username ASC').all();
						return jsonResponse(results || []);
					});
				}
				// POST /api/admin/users (Create user as admin)
				else if (method === 'POST' && path === 'admin/users') {
					response = await requireAdminAuth(request, env, ctx, async (req) => {
						const body = await req.json();
						const validationError = validateInput(body, ['username', 'password']);
						if (validationError) return jsonResponse({ error: validationError }, 400);
						const isAdmin = !!body.isAdmin;
						try {
							const passwordHash = await sha256(body.password);
							const { success, meta } = await env.DB.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?1, ?2, ?3)')
								.bind(body.username, passwordHash, isAdmin ? 1 : 0).run();
							if (success) { return jsonResponse({ success: true, userId: meta.last_row_id, username: body.username }, 201); }
							else { throw new Error("DB Insert failed."); }
						} catch (e) {
							if (e.message?.includes("UNIQUE constraint failed: users.username") || e.cause?.message?.includes("UNIQUE")) {
								return jsonResponse({ error: 'Username already taken.' }, 409);
							} throw e;
						}
					});
				}
				// DELETE /api/admin/users/:id (Delete user as admin)
				else if (method === 'DELETE' && pathSegments.length === 3 && pathSegments[0] === 'admin' && pathSegments[1] === 'users') {
					response = await requireAdminAuth(request, env, ctx, async (req) => {
						const userIdToDelete = parseInt(pathSegments[2], 10);
						if (isNaN(userIdToDelete)) return jsonResponse({ error: 'Invalid user ID.' }, 400);
						const requestingAdminId = req.userId;
						if (userIdToDelete === requestingAdminId) return jsonResponse({ error: 'Admin cannot delete their own account.' }, 403);
						const { success, meta } = await env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(userIdToDelete).run();
						if (success && meta.changes > 0) { console.log(`Admin ${requestingAdminId} deleted user ${userIdToDelete}`); return jsonResponse({ success: true }); }
						else if (success && meta.changes === 0) { return jsonResponse({ error: 'User not found.' }, 404); }
						else { throw new Error("Failed to delete user."); }
					});
				}
			} // End admin routes check


			// If no API route was matched by the 'if/else if' chain
			if (!response) {
				console.log("Worker: Unknown API route:", request.method, url.pathname);
				return jsonResponse({ error: 'API Endpoint Not Found' }, 404);
			}

			// Return the response generated by the matched handler
			return response;

		} catch (error) {
			// Catch errors from API handler execution / authorization / JSON parsing / DB errors etc.
			console.error(`API Handler Error (${method} /api/${path}):`, error, error.stack);
			if (error instanceof SyntaxError) { return jsonResponse({ error: 'Invalid JSON in request body.' }, 400); }
			if (error.message === "Password hashing failed internally.") { return jsonResponse({ error: 'Internal processing error.' }, 500); }
			const status = error.status || 500;
			const message = error.status ? error.message : 'An internal server error occurred.';
			if (status === 400) return jsonResponse({ error: message }, 400);
			if (status === 401) return jsonResponse({ error: message }, 401);
			if (status === 403) return jsonResponse({ error: message }, 403);
			if (status === 404) return jsonResponse({ error: message }, 404);
			if (status === 409) return jsonResponse({ error: message }, 409);
			if (status === 501) return jsonResponse({ error: message }, 501);
			return jsonResponse({ error: 'An unexpected internal server error occurred.' }, 500);
		}
	} // End handleApiRequest

}; // End export default Worker handler

// --- IMPORTANT: Export the Durable Object class ---
export { ChatCoordinatorDO }; // Assuming ChatCoordinatorDO is defined in './durableObjects.js'