// src/durableObjects.js
import { getConversationParticipants } from './db.js'; // Need DB access

/**
 * ChatCoordinatorDO Durable Object Class
 * Manages WebSocket connections, presence, and broadcasts real-time events.
 */
export class ChatCoordinatorDO {
    constructor(state, env) {
        this.state = state; // Durable Object state/storage (less used here)
        this.env = env;     // Environment bindings (DB, etc.)
        // In-memory map for WebSocket sessions: userId -> WebSocket
        this.sessions = new Map();
        // Map to track which conversation each user is viewing: userId -> conversationId
        this.viewingConversation = new Map();
        console.log(`ChatCoordinatorDO instance created/rehydrated. Initial sessions: ${this.sessions.size}`);
    }

    // Handles incoming HTTP requests (primarily WebSocket upgrades)
    async fetch(request) {
        const upgradeHeader = request.headers.get("upgrade");
        if (!upgradeHeader || upgradeHeader !== "websocket") {
            console.error("ChatCoordinatorDO: Received non-WebSocket request.");
            return new Response("Expected WebSocket upgrade", { status: 426 });
        }

        console.log("ChatCoordinatorDO: Received WebSocket upgrade request. Creating pair...");
        const { 0: clientWs, 1: serverWs } = new WebSocketPair();

        // Handle the server-side WebSocket session asynchronously
        this.state.waitUntil(this.handleWebSocketSession(serverWs, request)); // Pass request for potential info

        console.log("ChatCoordinatorDO: Returning 101 Switching Protocols.");
        return new Response(null, { status: 101, webSocket: clientWs });
    }

    /**
     * Manages a single WebSocket session after connection.
     * @param {WebSocket} ws - The server-side WebSocket object.
     * @param {Request} request - The initial upgrade request (optional info).
     */
    async handleWebSocketSession(ws, request) {
        ws.accept();
        console.log("ChatCoordinatorDO: Accepted WebSocket connection.");

        let userId = null; // User ID associated with this WebSocket

        // --- WebSocket Message Handler ---
        ws.addEventListener("message", async (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
                console.log(`ChatCoordinatorDO: Received message from user ${userId || 'unauth'}:`, message.type);
            } catch (e) {
                console.error("ChatCoordinatorDO: Error parsing WebSocket message:", e, event.data);
                this.sendMessage(ws, { type: 'error', message: 'Invalid message format.' });
                return; // Stop processing invalid message
            }

            try {
                // First message MUST be 'authenticate'
                if (!userId && message.type !== 'authenticate') {
                    console.warn("ChatCoordinatorDO: First message not authenticate. Closing socket.");
                    ws.close(1008, "Authentication required");
                    return;
                }

                switch (message.type) {
                    case 'authenticate':
                        const claimedUserId = parseInt(message.userId, 10);
                        const sessionToken = message.token;

                        // --- !! TODO: Replace placeholder with real JWT/Token verification !! ---
                        // Example: const verifiedUserId = await verifyTokenFromWorker(sessionToken); // Needs mechanism
                        const isValidToken = sessionToken && !isNaN(claimedUserId); // VERY basic placeholder check

                        if (isValidToken) {
                            // Check if user is already connected with a *different* socket
                            const existingSocket = this.sessions.get(claimedUserId);
                            if (existingSocket && existingSocket !== ws) {
                                console.warn(`ChatCoordinatorDO: User ${claimedUserId} connected elsewhere. Closing old socket.`);
                                existingSocket.close(1008, "Connected elsewhere");
                                this.sessions.delete(claimedUserId); // Remove old immediately
                                this.viewingConversation.delete(claimedUserId);
                            }

                            // Assign user ID and store session
                            userId = claimedUserId;
                            this.sessions.set(userId, ws);
                            console.log(`ChatCoordinatorDO: User ${userId} authenticated/re-authenticated. Sessions: ${this.sessions.size}`);

                            // Notify others this user is online
                            this.broadcast({ type: 'presenceUpdate', userId: userId, status: 'online' }, userId);

                            // Send current online snapshot to this user
                            const onlineUserIds = Array.from(this.sessions.keys()).filter(id => id !== userId);
                            this.sendMessage(ws, { type: 'presenceSnapshot', onlineUserIds });

                        } else {
                            console.warn(`ChatCoordinatorDO: Invalid authentication for userId ${claimedUserId}. Closing socket.`);
                            this.sendMessage(ws, { type: 'error', message: 'Authentication failed.' });
                            ws.close(1008, "Invalid authentication");
                            userId = null; // Ensure userId is nullified
                        }
                        break;

                    case 'subscribeConversation':
                        if (userId && message.conversationId) {
                            const conversationId = parseInt(message.conversationId, 10);
                            if (!isNaN(conversationId)) {
                                this.viewingConversation.set(userId, conversationId);
                                console.log(`ChatCoordinatorDO: User ${userId} viewing conversation ${conversationId}`);
                                // TODO: Potentially send 'read' status update for messages in this convo?
                            }
                        }
                        break;

                    case 'unsubscribeConversation':
                        if (userId) {
                            this.viewingConversation.delete(userId);
                            console.log(`ChatCoordinatorDO: User ${userId} stopped viewing a conversation`);
                        }
                        break;

                    case 'typing':
                        if (userId && message.conversationId && typeof message.isTyping === 'boolean') {
                            const conversationId = parseInt(message.conversationId, 10);
                            if (!isNaN(conversationId)) {
                                // Fetch participants (excluding sender) to notify
                                const participants = await getConversationParticipants(this.env.DB, conversationId, userId);
                                this.broadcastToUsers(participants, {
                                    type: 'typingUpdate',
                                    conversationId: conversationId,
                                    userId: userId,
                                    isTyping: message.isTyping
                                });
                            }
                        }
                        break;

                    case 'ping':
                        this.sendMessage(ws, { type: 'pong' });
                        break;

                    default:
                        console.warn(`ChatCoordinatorDO: Unknown message type from user ${userId}: ${message.type}`);
                }
            } catch (handlerError) {
                console.error(`ChatCoordinatorDO: Error handling message type ${message?.type} for user ${userId}:`, handlerError);
                this.sendMessage(ws, { type: 'error', message: 'Error processing message.' });
            }
        });

        // --- WebSocket Close/Error Handler ---
        const closeOrErrorHandler = (event) => {
            console.log(`ChatCoordinatorDO: WebSocket closed/error for user ${userId || 'unknown'}. Code: ${event?.code}, Reason: ${event?.reason}`);
            if (userId && this.sessions.get(userId) === ws) { // Only remove if it's the current socket for this user
                this.sessions.delete(userId);
                this.viewingConversation.delete(userId);
                console.log(`ChatCoordinatorDO: Removed session for user ${userId}. Active sessions: ${this.sessions.size}`);
                // Notify others this user went offline
                this.broadcast({ type: 'presenceUpdate', userId: userId, status: 'offline' }, userId); // Exclude self
            } else if (userId) {
                console.log(`ChatCoordinatorDO: Closed/errored socket for user ${userId} was not the active session.`);
            }
            userId = null; // Clear userId for this handler scope regardless
        };

        ws.addEventListener("close", closeOrErrorHandler);
        ws.addEventListener("error", closeOrErrorHandler);
    }

    // --- Broadcasting Methods ---

    /** Safely send a JSON message to a single WebSocket. */
    sendMessage(ws, message) {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            } else {
                console.warn(`ChatCoordinatorDO: Attempted send to non-OPEN socket for message type ${message?.type}.`);
            }
        } catch (e) {
            console.error(`ChatCoordinatorDO: Error sending message:`, e, message);
            // Consider closing the socket if send fails repeatedly or is fatal
            // ws.close(1011, "Unexpected error during send");
        }
    }

    /** Broadcast a message to all connected clients, optionally excluding one user. */
    broadcast(message, excludeUserId = null) {
        const messageString = JSON.stringify(message);
        this.sessions.forEach((ws, userId) => {
            if (userId !== excludeUserId) {
                this.sendMessage(ws, message); // Use sendMessage to handle readyState checks etc.
            }
        });
    }

    /** Broadcast a message to a specific list of user IDs. */
    broadcastToUsers(userIds, message) {
        if (!Array.isArray(userIds)) {
            console.error("broadcastToUsers received non-array userIds:", userIds);
            return;
        }
        userIds.forEach(userId => {
            const ws = this.sessions.get(userId);
            if (ws) {
                this.sendMessage(ws, message);
            }
            // else { console.log(`User ${userId} not connected, skipping broadcast for type ${message?.type}`); }
        });
    }

    // --- External Trigger Methods (Called via /internal/ routes) ---

    /** Called by Worker after new message saved to DB. */
    async forwardNewMessage(messageData, senderId) {
        console.log(`ChatCoordinatorDO: forwardNewMessage for conv ${messageData?.conversation_id}`);
        if (!messageData || !messageData.conversation_id || typeof senderId !== 'number') {
            console.error("forwardNewMessage received invalid data", messageData, senderId);
            return;
        }
        const conversationId = messageData.conversation_id;
        // Get all participants to potentially notify
        const participants = await getConversationParticipants(this.env.DB, conversationId);
        const payload = { type: 'newMessage', message: messageData };
        // Send to all connected participants (sender will receive their own message back too, confirming delivery)
        this.broadcastToUsers(participants, payload);
        console.log(`ChatCoordinatorDO: Broadcasted new message in conv ${conversationId} to potential participants:`, participants);
    }

    /** Called by Worker when a user blocks another. */
    async notifyBlock(blockerId, blockedId) {
        console.log(`ChatCoordinatorDO: notifyBlock ${blockerId} -> ${blockedId}`);
        const ws = this.sessions.get(blockedId);
        if (ws) {
            this.sendMessage(ws, { type: 'userBlocked', blockerId: blockerId });
        }
    }

    /** Called by Worker when a user unblocks another. */
    async notifyUnblock(blockerId, unblockedId) {
        console.log(`ChatCoordinatorDO: notifyUnblock ${blockerId} -> ${unblockedId}`);
        const ws = this.sessions.get(unblockedId);
        if (ws) {
            this.sendMessage(ws, { type: 'userUnblocked', blockerId: blockerId });
        }
    }

    /** Called by Worker when a user is added to a group. */
    async notifyGroupAdd(conversationId, addedUserId, groupName) {
        console.log(`ChatCoordinatorDO: notifyGroupAdd user ${addedUserId} to group ${conversationId}`);
        const ws = this.sessions.get(addedUserId);
        if (ws) {
            this.sendMessage(ws, { type: 'addedToGroup', conversationId: conversationId, groupName: groupName });
        }
        // Optionally notify existing members too?
        // const existingMembers = await getConversationParticipants(this.env.DB, conversationId, addedUserId);
        // this.broadcastToUsers(existingMembers, { type: 'participantJoinedGroup', conversationId, userId: addedUserId, username: 'TODO_FetchUsername' });
    }

    /** Called by Worker when a user is removed/leaves a group. */
    async notifyGroupRemove(conversationId, removedUserId, groupName) {
        console.log(`ChatCoordinatorDO: notifyGroupRemove user ${removedUserId} from group ${conversationId}`);
        // Notify the removed user first
        const wsRemoved = this.sessions.get(removedUserId);
        if (wsRemoved) {
            this.sendMessage(wsRemoved, { type: 'removedFromGroup', conversationId: conversationId, groupName: groupName });
        }
        // Notify remaining members
        const remainingParticipants = await getConversationParticipants(this.env.DB, conversationId); // Fetch remaining after DB delete
        this.broadcastToUsers(remainingParticipants, {
            type: 'participantLeftGroup',
            conversationId: conversationId,
            userId: removedUserId
            // TODO: Add username if needed by frontend
        });
    }

    // Optional: Notify participants when a group is deleted entirely
    /*
     async notifyGroupDelete(conversationId, participantIds) {
          console.log(`ChatCoordinatorDO: notifyGroupDelete group ${conversationId}`);
          this.broadcastToUsers(participantIds, { type: 'groupDeleted', conversationId: conversationId });
     }
    */

} // End ChatCoordinatorDO class