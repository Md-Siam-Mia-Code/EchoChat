document.addEventListener('DOMContentLoaded', () => {
     console.log("EchoChat Initializing...");

     // --- State Variables ---
     let currentState = 'loading';
     let currentUser = null;
     let currentConversationId = null;
     let conversations = [];
     let users = [];
     let allUsers = [];
     let blockedUsers = [];
     let messages = new Map();
     let webSocket = null;
     let wsReconnectTimeout = null;
     let onlineUsers = new Set();
     let typingTimeouts = new Map();
     let isLoading = { messages: false, conversations: false, users: false, allUsers: false, adminStats: false, adminUsers: false, blockedUsers: false };
     let currentErrorTimeout = null;
     let confirmationResolver = null;

     // --- Constants ---
     const API_BASE_URL = '/api';
     const WS_URL = (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host + '/ws';
     const RECONNECT_DELAY = 5000;
     const TYPING_INDICATOR_TIMEOUT = 3000;
     const THEME_STORAGE_KEY = 'echochat-theme';
     const SESSION_STORAGE_KEY = 'echochat-user';
     const MOBILE_BREAKPOINT = 768; // px, matches CSS

     // --- DOM Elements ---
     const bodyElement = document.body; // Get body element
     const htmlElement = document.documentElement;
     const loadingScreen = document.getElementById('loading-screen');
     const onboardingScreen = document.getElementById('onboarding-screen');
     const loginScreen = document.getElementById('login-screen');
     const chatAppScreen = document.getElementById('chat-app');
     const adminDashboardScreen = document.getElementById('admin-dashboard');
     const errorBanner = document.getElementById('error-banner');
     const errorBannerMessage = document.getElementById('error-banner-message');
     const errorBannerClose = document.getElementById('error-banner-close');
     const confirmationModal = document.getElementById('confirmation-modal');
     const confirmationMessage = document.getElementById('confirmation-message');
     const confirmYesButton = document.getElementById('confirm-yes-button');
     const confirmNoButton = document.getElementById('confirm-no-button');
     const onboardingForm = document.getElementById('onboarding-form');
     const onboardingError = document.getElementById('onboarding-error');
     const onboardingSubmit = document.getElementById('onboarding-submit');
     const onboardingUsername = document.getElementById('onboarding-username');
     const onboardingPassword = document.getElementById('onboarding-password');
     const onboardingMasterPassword = document.getElementById('onboarding-master-password');
     const userLoginTab = document.getElementById('user-login-tab');
     const adminLoginTab = document.getElementById('admin-login-tab');
     const userLoginForm = document.getElementById('user-login-form');
     const adminLoginForm = document.getElementById('admin-login-form');
     const registerForm = document.getElementById('register-form');
     const loginError = document.getElementById('login-error');
     const loginUsername = document.getElementById('login-username');
     const loginPassword = document.getElementById('login-password');
     const loginSubmit = document.getElementById('login-submit');
     const adminMasterPassword = document.getElementById('admin-master-password');
     const adminLoginSubmit = document.getElementById('admin-login-submit');
     const registerUsername = document.getElementById('register-username');
     const registerPassword = document.getElementById('register-password');
     const registerConfirmPassword = document.getElementById('register-confirm-password');
     const registerSubmit = document.getElementById('register-submit');
     const showRegisterButton = document.getElementById('show-register-button');
     const showLoginButton = document.getElementById('show-login-button');
     const switchToUserLoginButtons = document.querySelectorAll('.switch-to-user-login');
     const leftPanel = document.querySelector('.left-panel');
     const panelOverlay = document.getElementById('panel-overlay'); // Mobile overlay
     const myAvatarSummary = document.getElementById('my-avatar-summary');
     const myUsernameSummary = document.getElementById('my-username-summary');
     const createGroupButton = document.getElementById('create-group-button');
     const manageBlocksButton = document.getElementById('manage-blocks-button');
     const themeToggleButton = document.getElementById('theme-toggle-button');
     const adminThemeToggleButton = document.getElementById('admin-theme-toggle-button');
     const logoutButton = document.getElementById('logout-button');
     const conversationSearch = document.getElementById('conversation-search');
     const conversationListArea = document.getElementById('conversation-list-area');
     const conversationListPlaceholder = document.getElementById('conversation-list-placeholder');
     const rightPanel = document.querySelector('.right-panel');
     const chatViewPlaceholder = document.getElementById('chat-view-placeholder');
     const chatViewContent = document.getElementById('chat-view-content');
     const chatViewHeader = document.getElementById('chat-view-header');
     const mobileMenuToggle = document.getElementById('mobile-menu-toggle'); // Hamburger button
     const chatPartnerAvatar = document.getElementById('chat-partner-avatar');
     const chatPartnerName = document.getElementById('chat-partner-name');
     const chatPartnerStatus = document.getElementById('chat-partner-status');
     const chatPartnerStatusText = document.getElementById('chat-partner-status-text');
     const chatTypingIndicator = document.getElementById('chat-typing-indicator');
     const blockUserButton = document.getElementById('block-user-button');
     const deleteGroupButton = document.getElementById('delete-group-button');
     const addGroupMemberButton = document.getElementById('add-group-member-button');
     const refreshMessagesButton = document.getElementById('refresh-messages-button');
     const messageArea = document.getElementById('message-area');
     const messageAreaPlaceholder = document.getElementById('message-area-placeholder');
     const messageInput = document.getElementById('message-input');
     const sendButton = document.getElementById('send-button');
     const adminUsernameDisplay = document.getElementById('admin-username-display');
     const adminLogoutButton = document.getElementById('admin-logout-button');
     const statTotalUsers = document.getElementById('stat-total-users');
     const statTotalMessages = document.getElementById('stat-total-messages');
     const statTotalGroups = document.getElementById('stat-total-groups');
     const statActiveUsers = document.getElementById('stat-active-users');
     const adminUserError = document.getElementById('admin-user-error');
     const adminAddUserForm = document.getElementById('admin-add-user-form');
     const adminAddUsername = document.getElementById('admin-add-username');
     const adminAddPassword = document.getElementById('admin-add-password');
     const adminAddIsAdmin = document.getElementById('admin-add-isadmin');
     const adminAddUserButton = document.getElementById('admin-add-user-button');
     const adminUserListBody = document.getElementById('admin-user-list-body');
     const createGroupModal = document.getElementById('create-group-modal');
     const createGroupForm = document.getElementById('create-group-form');
     const groupNameInput = document.getElementById('group-name');
     const groupMembersSelect = document.getElementById('group-members-select');
     const createGroupSubmit = document.getElementById('create-group-submit');
     const createGroupError = document.getElementById('create-group-error');
     const manageBlocksModal = document.getElementById('manage-blocks-modal');
     const blockedUsersList = document.getElementById('blocked-users-list');
     const blockedListPlaceholder = document.getElementById('blocked-list-placeholder');
     const manageBlocksError = document.getElementById('manage-blocks-error');

     // --- Utility Functions ---
     const debounce = (func, wait) => { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; };
     const showElement = (el) => el && (el.style.display = (el.tagName === 'TABLE' || el.tagName === 'TBODY') ? 'table' : (el.classList.contains('login-form-panel') || el.classList.contains('chat-view-placeholder') || el.id === 'panel-overlay' ? 'block' : 'flex')); // Adjusted for overlay
     const hideElement = (el) => el && (el.style.display = 'none');
     const setButtonLoading = (button, isLoading) => { if (!button) return; button.disabled = isLoading; };
     const formatDate = (isoString) => { if (!isoString) return ''; try { const date = new Date(isoString); return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }); } catch { return 'Invalid time'; } };
     const formatFullDateTime = (isoString) => { if (!isoString) return ''; try { const date = new Date(isoString); return date.toLocaleString(); } catch { return 'Invalid date'; } };
     function escapeHtml(unsafe) { return unsafe ? String(unsafe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;") : ""; }
     function showError(message, duration = 5000) { console.error("UI Error:", message); if (!errorBannerMessage || !errorBanner) return; errorBannerMessage.textContent = message || 'An unexpected error occurred.'; errorBanner.classList.add('show'); if (currentErrorTimeout) clearTimeout(currentErrorTimeout); currentErrorTimeout = setTimeout(hideError, duration); }
     function hideError() { if (!errorBanner) return; errorBanner.classList.remove('show'); }
     function showConfirmation(message) { return new Promise((resolve) => { if (!confirmationModal || !confirmationMessage || !confirmNoButton) { console.error("Confirmation modal elements not found"); resolve(false); return; } confirmationMessage.textContent = message; showElement(confirmationModal); confirmationResolver = resolve; confirmNoButton.focus(); }); }
     function handleConfirmation(result) { if (!confirmationModal) return; hideElement(confirmationModal); if (confirmationResolver) { confirmationResolver(result); confirmationResolver = null; } }
     function scrollToBottom(element) { if (!element) return; requestAnimationFrame(() => { const isScrolledUp = element.scrollTop + element.clientHeight < element.scrollHeight - 150; if (!isScrolledUp) { element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }); } }); }
     function adjustTextareaHeight() { if (!messageInput || !sendButton) return; messageInput.style.height = 'auto'; const scrollHeight = messageInput.scrollHeight; const maxHeight = 120; messageInput.style.height = `${Math.min(scrollHeight, maxHeight)}px`; sendButton.disabled = messageInput.value.trim() === '' || isLoading.messages || messageInput.disabled; }
     const isMobileView = () => window.innerWidth <= MOBILE_BREAKPOINT;

     // --- Theme Functions ---
     function applyTheme(theme) { htmlElement.dataset.theme = theme; localStorage.setItem(THEME_STORAGE_KEY, theme); updateThemeIcons(theme); console.log(`Theme applied: ${theme}`); }
     function updateThemeIcons(theme) { const iconClass = theme === 'dark' ? 'fa-sun' : 'fa-moon'; const removeClass = theme === 'dark' ? 'fa-moon' : 'fa-sun'; themeToggleButton?.querySelector('i')?.classList.remove(removeClass); themeToggleButton?.querySelector('i')?.classList.add(iconClass); adminThemeToggleButton?.querySelector('i')?.classList.remove(removeClass); adminThemeToggleButton?.querySelector('i')?.classList.add(iconClass); }
     function getInitialTheme() { const savedTheme = localStorage.getItem(THEME_STORAGE_KEY); if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) { return savedTheme; } if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) { return 'dark'; } return 'light'; }
     function handleThemeToggle() { const currentTheme = htmlElement.dataset.theme || 'light'; const newTheme = currentTheme === 'dark' ? 'light' : 'dark'; applyTheme(newTheme); }

     // --- API Communication ---
     async function apiCall(endpoint, method = 'GET', body = null) { const url = `${API_BASE_URL}${endpoint}`; const headers = { 'Content-Type': 'application/json' }; if (currentUser?.token) { headers['Authorization'] = `Bearer ${currentUser.token}`; } const options = { method, headers }; if (body && method !== 'GET' && method !== 'HEAD') { options.body = JSON.stringify(body); } try { const response = await fetch(url, options); let responseData = null; const contentType = response.headers.get('content-type'); if (response.status !== 204 && contentType?.includes('application/json')) { try { responseData = await response.json(); } catch (jsonError) { console.error(`Invalid JSON received from ${method} ${url} (status ${response.status})`, await response.text()); throw new Error(`Invalid JSON received from server (status ${response.status})`); } } if (!response.ok) { const errorMessage = responseData?.error || `HTTP error ${response.status}: ${response.statusText}`; console.error(`API Error (${response.status}) at ${endpoint}:`, errorMessage, responseData); const error = new Error(errorMessage); error.status = response.status; error.data = responseData; if (response.status === 401 && currentState !== 'login' && currentState !== 'onboarding') { console.warn("API call returned 401, forcing logout."); showError("Your session expired. Please log in again."); logout(); } throw error; } return responseData ?? { success: true }; } catch (error) { if (!(error instanceof Error && error.status)) { console.error(`Network or fetch error calling ${endpoint}:`, error); showError(`Network error: ${error.message || 'Cannot reach server.'}`); } throw error; } }

     // --- WebSocket Management ---
     function connectWebSocket() { if (wsReconnectTimeout) clearTimeout(wsReconnectTimeout); if (!currentUser || !currentUser.token) { console.log("WS Connect skipped: No user logged in."); return; } if (webSocket && (webSocket.readyState === WebSocket.OPEN || webSocket.readyState === WebSocket.CONNECTING)) { console.log("WS Connect skipped: Already open or connecting."); return; } console.log("WS: Attempting connection..."); webSocket = new WebSocket(WS_URL); webSocket.onopen = () => { console.log("WS: Connection opened."); webSocket.send(JSON.stringify({ type: 'authenticate', userId: currentUser.id, token: currentUser.token })); onlineUsers.add(currentUser.id); updatePresenceIndicators(); if (currentState === 'admin') updateAdminActiveUsers(); if (currentConversationId) { webSocket.send(JSON.stringify({ type: 'subscribeConversation', conversationId: currentConversationId })); } }; webSocket.onmessage = (event) => { try { const message = JSON.parse(event.data); console.log("WS: Message received:", message); handleWebSocketMessage(message); } catch (e) { console.error("WS: Error parsing message:", e, event.data); } }; webSocket.onclose = (event) => { console.log(`WS: Connection closed. Code: ${event.code}, Reason: "${event.reason}"`); const wasConnectedUserId = currentUser?.id; webSocket = null; onlineUsers.clear(); updatePresenceIndicators(); if (currentState === 'admin') updateAdminActiveUsers(); if (wasConnectedUserId && event.code !== 1000 && currentState !== 'login' && currentState !== 'onboarding') { console.log(`WS: Attempting reconnect in ${RECONNECT_DELAY / 1000}s...`); wsReconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY); } else { wsReconnectTimeout = null; } }; webSocket.onerror = (event) => { console.error("WS: Error observed:", event); showError("WebSocket connection error."); if (webSocket) webSocket.close(); }; }
     function disconnectWebSocket() { if (wsReconnectTimeout) clearTimeout(wsReconnectTimeout); wsReconnectTimeout = null; if (webSocket) { console.log("WS: Closing connection intentionally."); webSocket.onclose = null; webSocket.onerror = null; webSocket.close(1000, "User logged out"); webSocket = null; } onlineUsers.clear(); updatePresenceIndicators(); if (currentState === 'admin') updateAdminActiveUsers(); }
     function handleWebSocketMessage(message) { let changedPresence = false; switch (message.type) { case 'newMessage': handleNewMessageRealtime(message.message); break; case 'presenceUpdate': if (message.status === 'online') { if (!onlineUsers.has(message.userId)) changedPresence = true; onlineUsers.add(message.userId); } else { if (onlineUsers.has(message.userId)) changedPresence = true; onlineUsers.delete(message.userId); } if (changedPresence) { updatePresenceIndicators(message.userId); if (currentState === 'admin') updateAdminActiveUsers(); } break; case 'presenceSnapshot': onlineUsers = new Set(message.onlineUserIds || []); if (currentUser) onlineUsers.add(currentUser.id); updatePresenceIndicators(); if (currentState === 'admin') updateAdminActiveUsers(); changedPresence = true; break; case 'typingUpdate': handleTypingIndicator(message.conversationId, message.userId, message.isTyping); break; case 'userBlocked': showError(`User ID ${message.blockerId} has blocked you.`); fetchConversationsAndUsers(); break; case 'userUnblocked': showError(`User ID ${message.blockerId} has unblocked you.`); fetchConversationsAndUsers(); break; case 'addedToGroup': showError(`You've been added to group: ${escapeHtml(message.groupName || 'Unnamed Group')}`); fetchConversationsAndUsers(); break; case 'removedFromGroup': showError(`You've been removed from group: ${escapeHtml(message.groupName || 'Unnamed Group')}`); if (currentConversationId === message.conversationId) { clearChatView(); } fetchConversationsAndUsers(); break; case 'participantLeftGroup': if (currentConversationId === message.conversationId) { showError(`User ${message.userId} left the group.`); } break; case 'pong': break; case 'error': showError(`WebSocket Error: ${message.message}`); break; default: console.warn("WS: Received unknown message type:", message.type); } }
     let typingTimer = null;
     function sendTypingIndicator(isTyping) { if (!webSocket || webSocket.readyState !== WebSocket.OPEN || !currentConversationId) return; if (!isTyping && typingTimer) clearTimeout(typingTimer); webSocket.send(JSON.stringify({ type: 'typing', conversationId: currentConversationId, isTyping: isTyping })); if (isTyping) { if (typingTimer) clearTimeout(typingTimer); typingTimer = setTimeout(() => { sendTypingIndicator(false); typingTimer = null; }, TYPING_INDICATOR_TIMEOUT); } else { typingTimer = null; } }
     function handleTypingIndicator(conversationId, userId, isTyping) { if (conversationId !== currentConversationId || userId === currentUser.id || !chatTypingIndicator) return; const indicatorId = `${conversationId}_${userId}`; const existingTimeout = typingTimeouts.get(indicatorId); if (isTyping) { showElement(chatTypingIndicator); chatTypingIndicator.textContent = `typing...`; if (existingTimeout) clearTimeout(existingTimeout); const timeoutId = setTimeout(() => { if (typingTimeouts.get(indicatorId) === timeoutId) { hideElement(chatTypingIndicator); typingTimeouts.delete(indicatorId); } }, TYPING_INDICATOR_TIMEOUT + 500); typingTimeouts.set(indicatorId, timeoutId); } else { if (existingTimeout) clearTimeout(existingTimeout); typingTimeouts.delete(indicatorId); if (typingTimeouts.size === 0) { hideElement(chatTypingIndicator); } } }
     function updatePresenceIndicators(specificUserId = null) { if (!chatPartnerAvatar || !conversationListArea) return; const headerPartnerId = parseInt(chatPartnerAvatar.dataset.userId || '0', 10); if (headerPartnerId && (!specificUserId || specificUserId === headerPartnerId)) { const isOnline = onlineUsers.has(headerPartnerId); updateChatHeaderStatus(isOnline); chatPartnerAvatar.classList.toggle('online', isOnline); chatPartnerAvatar.classList.toggle('offline', !isOnline); } conversationListArea.querySelectorAll('.conversation-item .avatar').forEach(avatarElement => { const partnerId = parseInt(avatarElement.dataset.userId || '0', 10); const isGroup = avatarElement.classList.contains('group'); if (!isGroup && partnerId && (!specificUserId || specificUserId === partnerId)) { const isOnline = onlineUsers.has(partnerId); avatarElement.classList.toggle('online', isOnline); avatarElement.classList.toggle('offline', !isOnline); } }); }
     function updateChatHeaderStatus(isOnline) { if (!chatPartnerStatus || !chatPartnerStatusText) return; const textToShow = isOnline ? 'Online' : 'Offline'; const classToAdd = isOnline ? 'online' : 'offline'; const classToRemove = isOnline ? 'offline' : 'online'; chatPartnerStatusText.textContent = textToShow; chatPartnerStatus.classList.remove(classToRemove); chatPartnerStatus.classList.add(classToAdd); }

     // --- UI Rendering Functions ---
     function switchState(newState) { console.log(`Switching state: ${currentState} -> ${newState}`); currentState = newState; hideElement(loadingScreen); hideElement(onboardingScreen); hideElement(loginScreen); hideElement(chatAppScreen); hideElement(adminDashboardScreen); switch (newState) { case 'loading': showElement(loadingScreen); break; case 'onboarding': showElement(onboardingScreen); break; case 'login': showElement(loginScreen); showUserLoginForm(); break; case 'chat': showElement(chatAppScreen); break; case 'admin': showElement(adminDashboardScreen); break; } hideError(); bodyElement.classList.remove('left-panel-active'); /* Ensure panel closed on state change */ }
     function showUserLoginForm() { hideElement(registerForm); hideElement(adminLoginForm); showElement(userLoginForm); userLoginTab?.classList.add('active'); adminLoginTab?.classList.remove('active'); if (loginError) loginError.textContent = ''; }
     function showAdminLoginForm() { hideElement(registerForm); hideElement(userLoginForm); showElement(adminLoginForm); adminLoginTab?.classList.add('active'); userLoginTab?.classList.remove('active'); if (loginError) loginError.textContent = ''; }
     function showRegisterForm() { hideElement(userLoginForm); hideElement(adminLoginForm); showElement(registerForm); userLoginTab?.classList.remove('active'); adminLoginTab?.classList.remove('active'); if (loginError) loginError.textContent = ''; }
     function renderConversationList() { if (!conversationListArea || !currentUser) return; conversationListArea.innerHTML = ''; if (isLoading.conversations || isLoading.allUsers) { conversationListArea.innerHTML = `<div class="list-placeholder">Loading chats & users...</div>`; return; } const visibleConversations = conversations.filter(convo => true); if (visibleConversations.length === 0 && allUsers.length === 0) { conversationListArea.innerHTML = `<div class="list-placeholder">No conversations or users found.</div>`; return; } const renderedUserIds = new Set(); visibleConversations.forEach(convo => { const item = document.createElement('div'); item.classList.add('conversation-item'); item.dataset.conversationId = convo.id; item.dataset.isGroup = convo.is_group; const name = convo.is_group ? convo.group_name : convo.partner_username; const partnerId = convo.is_group ? null : convo.partner_id; const isPartnerOnline = partnerId ? onlineUsers.has(partnerId) : false; if (partnerId) { item.dataset.partnerId = partnerId; renderedUserIds.add(partnerId); } const isActive = convo.id === currentConversationId; if (isActive) item.classList.add('active'); const escapedName = escapeHtml(name || 'Unnamed Chat'); const escapedSender = escapeHtml(convo.last_message_sender); const escapedContent = escapeHtml(convo.last_message_content || (convo.is_group ? 'Group chat' : 'No messages yet')); const snippet = `${escapedSender ? escapedSender + ': ' : ''}${escapedContent}`; const avatarClass = convo.is_group ? 'group' : (isPartnerOnline ? 'online' : 'offline'); const avatarIcon = convo.is_group ? 'fa-users' : 'fa-user'; item.innerHTML = `<div class="avatar small ${avatarClass}" data-user-id="${partnerId || ''}"><i class="fa-solid ${avatarIcon}"></i></div><div class="conversation-details"><span class="conversation-name">${escapedName}</span><span class="conversation-snippet">${snippet}</span></div><span class="conversation-timestamp">${formatDate(convo.last_message_ts || convo.last_activity_ts)}</span>${convo.unread_count > 0 ? '<div class="unread-indicator"></div>' : ''}`; item.addEventListener('click', () => selectConversation(convo.id)); conversationListArea.appendChild(item); }); const usersToRender = allUsers.filter(u => u.id !== currentUser.id && !renderedUserIds.has(u.id) && !blockedUsers.some(b => b.id === u.id)); if (visibleConversations.length > 0 && usersToRender.length > 0) { const userHeader = document.createElement('p'); userHeader.textContent = "Start Chatting"; userHeader.style.cssText = `font-size: 0.8em; color: var(--text-secondary); text-align: center; margin: 15px 0 5px 0; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7;`; conversationListArea.appendChild(userHeader); } usersToRender.forEach(user => { const item = document.createElement('div'); item.classList.add('conversation-item', 'user-list-item'); item.dataset.userId = user.id; const isOnline = onlineUsers.has(user.id); const escapedUsername = escapeHtml(user.username); const avatarClass = isOnline ? 'online' : 'offline'; item.innerHTML = `<div class="avatar small ${avatarClass}" data-user-id="${user.id}"><i class="fa-solid fa-user"></i></div><div class="conversation-details"><span class="conversation-name">${escapedUsername}</span><span class="conversation-snippet" style="font-style: italic; opacity: 0.7;">Click to start chat</span></div>`; item.addEventListener('click', () => handleStartNewConversation(user.id)); conversationListArea.appendChild(item); }); updatePresenceIndicators(); }
     function renderMessages(conversationId) { if (!messageArea) return; messageArea.innerHTML = ''; const currentMessages = messages.get(conversationId); if (isLoading.messages && (!currentMessages || currentMessages.length === 0)) { messageArea.innerHTML = `<div class="message-placeholder-style" id="message-area-placeholder">Loading messages... <i class="fa-solid fa-spinner fa-spin"></i></div>`; return; } if (!currentMessages || currentMessages.length === 0) { messageArea.innerHTML = `<div class="message-placeholder-style" id="message-area-placeholder">No messages in this conversation yet.</div>`; return; } currentMessages.forEach(msg => addMessageToUI(msg)); scrollToBottom(messageArea); }
     function addMessageToUI(msg, prepend = false) { if (!messageArea || !currentUser) return; const placeholder = document.getElementById('message-area-placeholder'); if (placeholder) placeholder.remove(); if (messageArea.querySelector(`.message[data-message-id="${msg.id}"]`)) { console.warn(`Attempted to add duplicate message UI for ID: ${msg.id}`); return; } const messageDiv = document.createElement('div'); messageDiv.classList.add('message'); messageDiv.dataset.messageId = msg.id; const isSent = msg.sender_id === currentUser.id; messageDiv.classList.add(isSent ? 'sent' : 'received'); if (msg.isOptimistic) { messageDiv.classList.add('sending'); messageDiv.setAttribute('aria-live', 'polite'); } messageDiv.innerHTML = `<span>${escapeHtml(msg.content)}</span><span class="message-timestamp">${formatDate(msg.timestamp)}</span>${isSent && !msg.isOptimistic ? `<button class="delete-button" aria-label="Delete this message" title="Delete Message"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>` : ''}`; if (isSent && !msg.isOptimistic) { const deleteBtn = messageDiv.querySelector('.delete-button'); if (deleteBtn) deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); handleDeleteMessage(msg.conversation_id, msg.id, messageDiv); }); } if (prepend) { messageArea.insertBefore(messageDiv, messageArea.firstChild); } else { messageArea.appendChild(messageDiv); } }
     function removeOptimisticMessage(tempId) { if (!messageArea) return; const messageElement = messageArea.querySelector(`.message.sending[data-message-id="${tempId}"]`); if (messageElement) { messageElement.remove(); if (messageArea.children.length === 0 && currentConversationId) { renderMessages(currentConversationId); } } }
     function updateChatHeader(conversation) { if (!conversation || !chatViewHeader || !chatPartnerName || !chatPartnerAvatar) return; const isGroup = conversation.is_group; const name = isGroup ? conversation.group_name : conversation.partner_username; const partnerId = isGroup ? null : conversation.partner_id; chatViewHeader.dataset.conversationId = conversation.id; chatViewHeader.dataset.userId = partnerId || ''; chatViewHeader.dataset.isGroup = String(isGroup); chatPartnerName.textContent = escapeHtml(name || 'Unnamed Chat'); const partnerIcon = chatPartnerAvatar.querySelector('i'); if (partnerIcon) { partnerIcon.className = `fa-solid ${isGroup ? 'fa-users' : 'fa-user'}`; } chatPartnerAvatar.classList.toggle('group', isGroup); chatPartnerAvatar.dataset.userId = partnerId || ''; hideElement(blockUserButton); hideElement(deleteGroupButton); hideElement(addGroupMemberButton); hideElement(chatPartnerStatus); hideElement(chatTypingIndicator); showElement(refreshMessagesButton); if (!isGroup && partnerId) { showElement(chatPartnerStatus); const isOnline = onlineUsers.has(partnerId); updateChatHeaderStatus(isOnline); chatPartnerAvatar.classList.toggle('online', isOnline); chatPartnerAvatar.classList.toggle('offline', !isOnline); if (!blockedUsers.some(b => b.id === partnerId)) { showElement(blockUserButton); blockUserButton.dataset.userId = partnerId; } } else if (isGroup) { chatPartnerAvatar.classList.remove('online', 'offline'); showElement(deleteGroupButton); deleteGroupButton.dataset.conversationId = conversation.id; showElement(addGroupMemberButton); addGroupMemberButton.dataset.conversationId = conversation.id; hideElement(blockUserButton); hideElement(chatPartnerStatus); } else { chatPartnerAvatar.classList.remove('online', 'offline', 'group'); } enableChatInput(conversation); }
     function enableChatInput(conversation) { if (!messageInput || !sendButton) return; let shouldEnable = true; let disableReason = ""; if (conversation && !conversation.is_group && conversation.partner_id) { if (blockedUsers.some(u => u.id === conversation.partner_id)) { shouldEnable = false; disableReason = "You have blocked this user. Unblock them to send messages."; } } if (!conversation) { shouldEnable = false; } messageInput.disabled = !shouldEnable; messageInput.placeholder = shouldEnable ? "Type your message..." : disableReason || "Select a conversation"; sendButton.disabled = !shouldEnable || messageInput.value.trim() === ''; adjustTextareaHeight(); }
     function clearChatView() { hideElement(chatViewContent); showElement(chatViewPlaceholder); const previousConversationId = currentConversationId; currentConversationId = null; if (messageInput) { messageInput.value = ''; messageInput.disabled = true; adjustTextareaHeight(); } if (sendButton) sendButton.disabled = true; if (webSocket && webSocket.readyState === WebSocket.OPEN && previousConversationId) { webSocket.send(JSON.stringify({ type: 'unsubscribeConversation' })); console.log(`WS: Unsubscribed from conversation ${previousConversationId}`); } document.querySelectorAll('.conversation-item.active').forEach(el => el.classList.remove('active')); if (chatPartnerName) chatPartnerName.textContent = "Select Chat"; if (chatPartnerAvatar) { const partnerIcon = chatPartnerAvatar.querySelector('i'); if (partnerIcon) partnerIcon.className = 'fa-solid fa-user'; chatPartnerAvatar.classList.remove('online', 'offline', 'group'); chatPartnerAvatar.dataset.userId = ''; } hideElement(chatPartnerStatus); hideElement(blockUserButton); hideElement(deleteGroupButton); hideElement(addGroupMemberButton); hideElement(refreshMessagesButton); enableChatInput(null); bodyElement.classList.remove('left-panel-active'); /* Ensure panel closed */ }
     function renderAdminStats(stats) { if (!statTotalUsers || !statTotalMessages || !statTotalGroups) return; statTotalUsers.textContent = stats?.userCount ?? '--'; statTotalMessages.textContent = stats?.messageCount ?? '--'; statTotalGroups.textContent = stats?.groupCount ?? '--'; }
     function updateAdminActiveUsers() { if (currentState === 'admin' && statActiveUsers) { statActiveUsers.textContent = onlineUsers.size; } }
     function renderAdminUserList(users) { if (!adminUserListBody || !currentUser) return; adminUserListBody.innerHTML = ''; if (!users || users.length === 0) { adminUserListBody.innerHTML = '<tr><td colspan="5" class="list-placeholder">No users found.</td></tr>'; return; } users.forEach(user => { const row = document.createElement('tr'); const isAdminCheck = user.is_admin ? `<i class="fa-solid fa-check" style="color: ${htmlElement.dataset.theme === 'dark' ? 'var(--color-success)' : 'var(--color-success)'};"></i> Yes` : 'No'; const escapedUsername = escapeHtml(user.username); const actions = currentUser.id !== user.id ? `<button class="action-button delete-user-button" data-user-id="${user.id}" data-username="${escapedUsername}" title="Delete User"><i class="fa-solid fa-trash-can"></i></button>` : '(Current Admin)'; row.innerHTML = `<td>${user.id}</td><td>${escapedUsername}</td><td>${isAdminCheck}</td><td>${formatFullDateTime(user.created_at)}</td><td>${actions}</td>`; const deleteBtn = row.querySelector('.delete-user-button'); if (deleteBtn) { deleteBtn.addEventListener('click', handleDeleteUserByAdmin); } adminUserListBody.appendChild(row); }); }
     function renderGroupMemberSelection(users) { if (!groupMembersSelect || !currentUser) return; groupMembersSelect.innerHTML = ''; if (!users) { groupMembersSelect.innerHTML = '<p class="list-placeholder">Loading users...</p>'; return; } const otherUsers = users.filter(user => user.id !== currentUser.id && !blockedUsers.some(b => b.id === user.id)); if (otherUsers.length === 0) { groupMembersSelect.innerHTML = '<p class="list-placeholder">No other users found to add.</p>'; return; } otherUsers.forEach(user => { const item = document.createElement('div'); item.classList.add('user-select-item'); const escapedUsername = escapeHtml(user.username); item.innerHTML = `<label><input type="checkbox" class="styled-checkbox group-member-checkbox" value="${user.id}"><div class="avatar small"><i class="fa-solid fa-user"></i></div><span>${escapedUsername}</span></label>`; groupMembersSelect.appendChild(item); }); }
     function renderBlockedUsersList() { if (!blockedUsersList) return; blockedUsersList.innerHTML = ''; if (isLoading.blockedUsers) { blockedUsersList.innerHTML = `<p class="list-placeholder" id="blocked-list-placeholder">Loading blocked users...</p>`; return; } if (!blockedUsers || blockedUsers.length === 0) { blockedUsersList.innerHTML = `<p class="list-placeholder" id="blocked-list-placeholder">You haven't blocked anyone.</p>`; return; } blockedUsers.forEach(user => { const item = document.createElement('div'); item.classList.add('blocked-user-item'); const escapedUsername = escapeHtml(user.username); item.innerHTML = `<div class="blocked-user-info"><div class="avatar small"><i class="fa-solid fa-user"></i></div><span>${escapedUsername}</span></div><button class="button unblock-button" data-user-id="${user.id}"><span class="button-text">Unblock</span><i class="fa-solid fa-spinner fa-spin button-spinner" style="display: none;"></i></button>`; const unblockBtn = item.querySelector('.unblock-button'); if (unblockBtn) { unblockBtn.addEventListener('click', handleUnblockUser); } blockedUsersList.appendChild(item); }); }

     // --- Data Fetching Functions ---
     async function checkSetupStatus() { try { const data = await apiCall('/setup/status'); return data.adminExists; } catch (error) { showError("Could not check application status. Please refresh."); return null; } }
     async function fetchConversationsAndUsers() { if (isLoading.conversations || isLoading.allUsers) return; isLoading.conversations = true; isLoading.allUsers = true; renderConversationList(); try { const [convResponse, usersResponse] = await Promise.all([apiCall('/conversations').catch(err => { console.error("Failed to fetch conversations:", err); showError(`Failed to load conversations: ${err.message}`); return []; }), apiCall('/users').catch(err => { console.error("Failed to fetch users:", err); showError(`Failed to load user list: ${err.message}`); return []; })]); conversations = convResponse || []; allUsers = usersResponse || []; conversations.sort((a, b) => new Date(b.last_activity_ts || 0) - new Date(a.last_activity_ts || 0)); allUsers.sort((a, b) => a.username.localeCompare(b.username)); } catch (error) { showError("An unexpected error occurred while loading data."); conversations = []; allUsers = []; } finally { isLoading.conversations = false; isLoading.allUsers = false; renderConversationList(); } }
     async function fetchMessagesForConversation(conversationId) { if (isLoading.messages) return; isLoading.messages = true; messages.set(conversationId, []); renderMessages(conversationId); try { const fetched = await apiCall(`/conversations/${conversationId}/messages`); const sortedMessages = (fetched || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)); messages.set(conversationId, sortedMessages); } catch (error) { if (error.status === 404) { showError(`Conversation or messages not found (ID: ${conversationId}).`); } else { showError(`Failed to load messages: ${error.message}`); } messages.set(conversationId, []); } finally { isLoading.messages = false; renderMessages(conversationId); } }
     async function fetchUsersForList() { if (isLoading.users) return; isLoading.users = true; renderGroupMemberSelection(null); try { users = await apiCall('/users') || []; renderGroupMemberSelection(users); } catch (error) { showError("Failed to load users list for group creation."); users = []; renderGroupMemberSelection([]); } finally { isLoading.users = false; } }
     async function fetchBlockedUsers() { if (isLoading.blockedUsers) return; isLoading.blockedUsers = true; renderBlockedUsersList(); try { blockedUsers = await apiCall('/blocks') || []; } catch (error) { showError("Failed to load blocked users list."); blockedUsers = []; } finally { isLoading.blockedUsers = false; renderBlockedUsersList(); } }
     async function fetchAdminStats() { if (isLoading.adminStats) return; isLoading.adminStats = true; try { const stats = await apiCall('/admin/stats'); renderAdminStats(stats); } catch (error) { showError(`Failed to load admin statistics: ${error.message}`); renderAdminStats({}); } finally { isLoading.adminStats = false; } }
     async function fetchAdminUsers() { if (isLoading.adminUsers) return; isLoading.adminUsers = true; renderAdminUserList([]); try { const adminUsers = await apiCall('/admin/users'); renderAdminUserList(adminUsers || []); } catch (error) { showError(`Failed to load user list for admin: ${error.message}`); renderAdminUserList([]); } finally { isLoading.adminUsers = false; } }

     // --- Event Handlers ---
     async function handleOnboardingSubmit(event) { event.preventDefault(); if (!onboardingUsername || !onboardingPassword || !onboardingMasterPassword || !onboardingError || !onboardingSubmit) return; const username = onboardingUsername.value.trim(); const password = onboardingPassword.value; const masterPassword = onboardingMasterPassword.value; onboardingError.textContent = ''; if (!username || !password || !masterPassword) { onboardingError.textContent = 'All fields are required.'; return; } if (password.length < 8) { onboardingError.textContent = 'Admin password must be at least 8 characters.'; return; } if (masterPassword.length < 10) { onboardingError.textContent = 'Master password must be at least 10 characters.'; return; } setButtonLoading(onboardingSubmit, true); try { await apiCall('/setup/admin', 'POST', { username, password, masterPassword }); showError("Admin account created! Please log in.", 5000); switchState('login'); } catch (error) { onboardingError.textContent = `Setup failed: ${error.message}`; } finally { setButtonLoading(onboardingSubmit, false); } }
     async function handleUserLoginSubmit(event) { event.preventDefault(); if (!loginUsername || !loginPassword || !loginError || !loginSubmit) return; const username = loginUsername.value.trim(); const password = loginPassword.value; loginError.textContent = ''; if (!username || !password) { loginError.textContent = 'Username and password required.'; return; } setButtonLoading(loginSubmit, true); try { const data = await apiCall('/auth/login', 'POST', { username, password }); currentUser = { ...data.user, token: data.token }; sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(currentUser)); initializeChatView(); } catch (error) { loginError.textContent = `Login failed: ${error.message}`; } finally { setButtonLoading(loginSubmit, false); } }
     async function handleAdminLoginSubmit(event) { event.preventDefault(); if (!adminMasterPassword || !loginError || !adminLoginSubmit) return; const masterPassword = adminMasterPassword.value; loginError.textContent = ''; if (!masterPassword) { loginError.textContent = 'Master password required.'; return; } setButtonLoading(adminLoginSubmit, true); try { const data = await apiCall('/auth/admin/login', 'POST', { masterPassword }); currentUser = { ...data.user, token: data.token }; sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(currentUser)); initializeAdminDashboard(); } catch (error) { loginError.textContent = `Admin login failed: ${error.message}`; } finally { setButtonLoading(adminLoginSubmit, false); adminMasterPassword.value = ''; } }
     async function handleRegisterSubmit(event) { event.preventDefault(); if (!registerUsername || !registerPassword || !registerConfirmPassword || !loginError || !registerSubmit) return; const username = registerUsername.value.trim(); const password = registerPassword.value; const confirmPassword = registerConfirmPassword.value; loginError.textContent = ''; if (!username || !password || !confirmPassword) { loginError.textContent = 'All fields are required.'; return; } if (username.length < 3) { loginError.textContent = 'Username must be at least 3 characters.'; return; } if (password.length < 8) { loginError.textContent = 'Password must be at least 8 characters.'; return; } if (password !== confirmPassword) { loginError.textContent = 'Passwords do not match.'; return; } setButtonLoading(registerSubmit, true); try { await apiCall('/users', 'POST', { username, password }); showError("Registration successful! Please log in.", 5000); showUserLoginForm(); registerUsername.value = ''; registerPassword.value = ''; registerConfirmPassword.value = ''; } catch (error) { loginError.textContent = `Registration failed: ${error.message}`; } finally { setButtonLoading(registerSubmit, false); } }

     function selectConversation(conversationId) {
          if (isLoading.messages || conversationId === currentConversationId) return;
          console.log(`Selecting conversation: ${conversationId}`);

          if (webSocket && webSocket.readyState === WebSocket.OPEN && currentConversationId) {
               webSocket.send(JSON.stringify({ type: 'unsubscribeConversation' }));
               console.log(`WS: Unsubscribed from conversation ${currentConversationId}`);
          }
          currentConversationId = conversationId;

          document.querySelectorAll('.conversation-item.active').forEach(item => item.classList.remove('active'));
          const selectedItem = document.querySelector(`.conversation-item[data-conversation-id="${conversationId}"]`);
          if (selectedItem) selectedItem.classList.add('active');

          const conversation = conversations.find(c => c.id === conversationId);
          if (conversation) {
               updateChatHeader(conversation);
               showElement(chatViewContent);
               hideElement(chatViewPlaceholder);
               fetchMessagesForConversation(conversationId);
               if (messageInput) messageInput.focus();
               if (webSocket && webSocket.readyState === WebSocket.OPEN) {
                    webSocket.send(JSON.stringify({ type: 'subscribeConversation', conversationId: conversationId }));
                    console.log(`WS: Subscribed to conversation ${conversationId}`);
               }
               // Close mobile panel if open
               if (isMobileView()) {
                    bodyElement.classList.remove('left-panel-active');
               }
          } else {
               console.error(`Conversation ${conversationId} not found in local state.`);
               showError("Could not find conversation details.");
               clearChatView();
          }
     }

     async function handleSendMessage() { if (!messageInput || !sendButton || !currentUser) return; const content = messageInput.value.trim(); if (!content || !currentConversationId || isLoading.messages || messageInput.disabled) return; isLoading.messages = true; setButtonLoading(sendButton, true); messageInput.disabled = true; const tempId = `temp_${Date.now()}`; const optimisticMessage = { id: tempId, conversation_id: currentConversationId, sender_id: currentUser.id, sender_username: currentUser.username, content: content, timestamp: new Date().toISOString(), isOptimistic: true }; addMessageToUI(optimisticMessage); scrollToBottom(messageArea); const originalInput = messageInput.value; messageInput.value = ''; adjustTextareaHeight(); try { await apiCall(`/conversations/${currentConversationId}/messages`, 'POST', { content }); sendTypingIndicator(false); } catch (error) { showError(`Failed to send message: ${error.message}`); removeOptimisticMessage(tempId); messageInput.value = originalInput; adjustTextareaHeight(); } finally { isLoading.messages = false; const currentConvo = conversations.find(c => c.id === currentConversationId); if (currentConvo) enableChatInput(currentConvo); setButtonLoading(sendButton, false); if (!messageInput.disabled) messageInput.focus(); } }
     function handleNewMessageRealtime(message) { if (!message || !message.conversation_id || !currentUser) { console.warn("Received invalid message data or user not set:", message); return; } const conversationId = message.conversation_id; const senderIsBlocked = blockedUsers.some(b => b.id === message.sender_id); if (senderIsBlocked && message.sender_id !== currentUser.id) { console.log(`Ignoring message from blocked user ${message.sender_id}`); return; } const optimisticBubble = (conversationId === currentConversationId) ? messageArea?.querySelector(`.message.sending`) : null; if (optimisticBubble && message.sender_id === currentUser.id) { console.log("Replacing optimistic message with server confirmation:", message.id); optimisticBubble.remove(); } let convoMessages = messages.get(conversationId) || []; if (!convoMessages.some(m => m.id === message.id)) { convoMessages.push(message); convoMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)); messages.set(conversationId, convoMessages); } if (conversationId === currentConversationId) { if (!messageArea?.querySelector(`.message[data-message-id="${message.id}"]`)) { addMessageToUI(message); scrollToBottom(messageArea); } } const convoIndex = conversations.findIndex(c => c.id === conversationId); if (convoIndex > -1) { conversations[convoIndex].last_message_content = message.content; conversations[convoIndex].last_message_ts = message.timestamp; conversations[convoIndex].last_message_sender = message.sender_username; conversations[convoIndex].last_activity_ts = message.timestamp; if (conversationId !== currentConversationId) { conversations[convoIndex].unread_count = (conversations[convoIndex].unread_count || 0) + 1; } conversations.sort((a, b) => new Date(b.last_activity_ts || 0) - new Date(a.last_activity_ts || 0)); renderConversationList(); } else { const isNewOneOnOne = !message.is_group && message.sender_id !== currentUser.id; if (isNewOneOnOne && !senderIsBlocked) { console.log(`New message received for an unknown conversation (${conversationId}), refreshing list...`); fetchConversationsAndUsers(); } else if (message.is_group) { console.log(`New message received for an unknown group conversation (${conversationId}), refreshing list...`); fetchConversationsAndUsers(); } } }
     async function handleDeleteMessage(conversationId, messageId, messageElement) { if (isLoading.messages || !messageElement) return; const confirmed = await showConfirmation("Are you sure you want to delete this message? This cannot be undone."); if (!confirmed) return; isLoading.messages = true; messageElement.style.opacity = '0.5'; const deleteButton = messageElement.querySelector('.delete-button'); if (deleteButton) setButtonLoading(deleteButton, true); try { await apiCall(`/messages/${messageId}`, 'DELETE'); messageElement.classList.add('deleting'); const removeElement = () => { messageElement.remove(); let convoMessages = messages.get(conversationId) || []; messages.set(conversationId, convoMessages.filter(m => m.id !== messageId)); if (messageArea && messageArea.children.length === 0) { renderMessages(conversationId); } }; messageElement.addEventListener('transitionend', removeElement, { once: true }); setTimeout(() => { if (messageElement.parentNode) removeElement(); }, 450); } catch (error) { showError(`Failed to delete message: ${error.message}`); messageElement.style.opacity = '1'; if (deleteButton) setButtonLoading(deleteButton, false); } finally { isLoading.messages = false; } }
     function logout() { console.log("Logging out..."); currentUser = null; sessionStorage.removeItem(SESSION_STORAGE_KEY); disconnectWebSocket(); currentConversationId = null; conversations = []; users = []; allUsers = []; blockedUsers = []; messages.clear(); onlineUsers.clear(); switchState('login'); if (conversationListArea) conversationListArea.innerHTML = ''; clearChatView(); if (adminUserListBody) adminUserListBody.innerHTML = ''; }

     // --- Modal Handlers ---
     function openCreateGroupModal() { if (!createGroupModal || !createGroupForm || !createGroupError) return; createGroupError.textContent = ''; createGroupForm.reset(); fetchUsersForList(); showElement(createGroupModal); groupNameInput?.focus(); }
     function closeCreateGroupModal() { hideElement(createGroupModal); }
     async function handleCreateGroupSubmit(event) { event.preventDefault(); if (!groupNameInput || !groupMembersSelect || !createGroupError || !createGroupSubmit) return; const groupName = groupNameInput.value.trim(); const selectedMemberCheckboxes = groupMembersSelect.querySelectorAll('.group-member-checkbox:checked'); const memberIds = Array.from(selectedMemberCheckboxes).map(cb => parseInt(cb.value, 10)); createGroupError.textContent = ''; if (!groupName) { createGroupError.textContent = 'Group name is required.'; return; } if (memberIds.length === 0) { createGroupError.textContent = 'Select at least one member.'; return; } setButtonLoading(createGroupSubmit, true); try { const result = await apiCall('/groups', 'POST', { name: groupName, members: memberIds }); showError(`Group "${escapeHtml(groupName)}" created!`, 3000); closeCreateGroupModal(); await fetchConversationsAndUsers(); selectConversation(result.conversationId); } catch (error) { createGroupError.textContent = `Failed to create group: ${error.message}`; } finally { setButtonLoading(createGroupSubmit, false); } }
     function openManageBlocksModal() { if (!manageBlocksModal || !manageBlocksError) return; manageBlocksError.textContent = ''; fetchBlockedUsers(); showElement(manageBlocksModal); }
     function closeManageBlocksModal() { hideElement(manageBlocksModal); }
     async function handleUnblockUser(event) { const button = event.target.closest('button'); if (!button) return; const userIdToUnblock = parseInt(button.dataset.userId, 10); if (isNaN(userIdToUnblock)) return; setButtonLoading(button, true); if (manageBlocksError) manageBlocksError.textContent = ''; try { await apiCall(`/blocks/${userIdToUnblock}`, 'DELETE'); blockedUsers = blockedUsers.filter(u => u.id !== userIdToUnblock); renderBlockedUsersList(); showError("User unblocked.", 2000); await fetchConversationsAndUsers(); if (currentConversationId) { const currentConvo = conversations.find(c => c.id === currentConversationId); if (currentConvo && !currentConvo.is_group && currentConvo.partner_id === userIdToUnblock) { enableChatInput(currentConvo); updateChatHeader(currentConvo); } } } catch (error) { if (manageBlocksError) manageBlocksError.textContent = `Failed to unblock user: ${error.message}`; } finally { setButtonLoading(button, false); } }
     async function handleBlockUser(userIdToBlock) { if (!userIdToBlock || !currentUser || userIdToBlock === currentUser.id) return; const userToBlockData = allUsers.find(u => u.id === userIdToBlock) || conversations.find(c => !c.is_group && c.partner_id === userIdToBlock); const usernameToBlock = userToBlockData ? (userToBlockData.username || userToBlockData.partner_username) : `User ID ${userIdToBlock}`; const confirmed = await showConfirmation(`Are you sure you want to block ${escapeHtml(usernameToBlock)}?`); if (!confirmed) return; console.log(`Attempting to block user ${userIdToBlock}`); const blockButtonInHeader = blockUserButton && blockUserButton.dataset.userId == userIdToBlock ? blockUserButton : null; if (blockButtonInHeader) setButtonLoading(blockButtonInHeader, true); try { await apiCall('/blocks', 'POST', { userId: userIdToBlock }); await fetchBlockedUsers(); showError("User blocked.", 3000); await fetchConversationsAndUsers(); if (currentConversationId) { const currentConvo = conversations.find(co => co.id === currentConversationId); if (currentConvo && !currentConvo.is_group && currentConvo.partner_id === userIdToBlock) { enableChatInput(currentConvo); updateChatHeader(currentConvo); } } } catch (error) { showError(`Failed to block user: ${error.message}`); } finally { if (blockButtonInHeader) setButtonLoading(blockButtonInHeader, false); } }
     function handleBlockUserFromHeader(event) { const button = event.currentTarget; const userIdToBlock = parseInt(button.dataset.userId, 10); if (!isNaN(userIdToBlock)) { handleBlockUser(userIdToBlock); } else { console.error("Could not get user ID from block button dataset."); } }
     async function handleDeleteGroup(event) { const button = event.currentTarget; const conversationId = parseInt(button.dataset.conversationId, 10); if (isNaN(conversationId)) return; const group = conversations.find(c => c.id === conversationId && c.is_group); if (!group) { console.error("Group not found for deletion button."); return; } const confirmed = await showConfirmation(`Are you sure you want to delete the group "${escapeHtml(group.group_name)}"? This cannot be undone.`); if (!confirmed) return; setButtonLoading(button, true); try { await apiCall(`/groups/${conversationId}`, 'DELETE'); showError(`Group "${escapeHtml(group.group_name)}" deleted.`, 3000); await fetchConversationsAndUsers(); clearChatView(); } catch (error) { if (error.status === 404) { showError(`Delete group functionality not yet implemented on server.`); } else { showError(`Failed to delete group: ${error.message}`); } } finally { setButtonLoading(button, false); } }
     async function handleStartNewConversation(partnerId) {
          if (!partnerId || !currentUser || partnerId === currentUser.id || isLoading.conversations) return;
          console.log(`Attempting to start conversation with user ID: ${partnerId}`);
          const userItem = conversationListArea?.querySelector(`.user-list-item[data-user-id="${partnerId}"]`);
          if (userItem && isMobileView()) userItem.style.opacity = '0.6'; // Dim only on mobile click?
          isLoading.conversations = true;

          try {
               const result = await apiCall('/conversations', 'POST', { partnerId: partnerId });
               if (result && result.success && result.conversationId) {
                    await fetchConversationsAndUsers(); // Refresh list first
                    selectConversation(result.conversationId); // Select and maybe close panel
               } else {
                    showError(result?.error || "Could not start conversation.");
                    if (userItem) userItem.style.opacity = '1';
               }
          } catch (error) {
               showError(`Error starting conversation: ${error.message}`);
               if (userItem) userItem.style.opacity = '1';
          } finally {
               isLoading.conversations = false;
          }
     }

     // --- Admin Dashboard Handlers ---
     async function handleAdminAddUserSubmit(event) { event.preventDefault(); if (!adminAddUsername || !adminAddPassword || !adminAddIsAdmin || !adminUserError || !adminAddUserButton) return; const username = adminAddUsername.value.trim(); const password = adminAddPassword.value; const isAdmin = adminAddIsAdmin.checked; adminUserError.textContent = ''; if (!username || !password) { adminUserError.textContent = 'Username and password required.'; return; } if (username.length < 3) { adminUserError.textContent = 'Username must be at least 3 characters.'; return; } if (password.length < 8) { adminUserError.textContent = 'Password must be at least 8 characters.'; return; } setButtonLoading(adminAddUserButton, true); try { await apiCall('/admin/users', 'POST', { username, password, isAdmin }); showError(`User "${escapeHtml(username)}" created.`, 3000); adminAddUserForm.reset(); fetchAdminUsers(); fetchAdminStats(); } catch (error) { adminUserError.textContent = `Failed to add user: ${error.message}`; } finally { setButtonLoading(adminAddUserButton, false); } }
     async function handleDeleteUserByAdmin(event) { const button = event.currentTarget; const userIdToDelete = parseInt(button.dataset.userId, 10); const usernameToDelete = button.dataset.username; if (isNaN(userIdToDelete) || !currentUser || userIdToDelete === currentUser.id) { showError("Cannot delete this user.", 3000); return; } const confirmed = await showConfirmation(`Delete user "${usernameToDelete}" (ID: ${userIdToDelete})? This action is permanent and will delete their messages.`); if (!confirmed) return; setButtonLoading(button, true); if (adminUserError) adminUserError.textContent = ''; try { await apiCall(`/admin/users/${userIdToDelete}`, 'DELETE'); showError(`User "${usernameToDelete}" deleted.`, 3000); fetchAdminUsers(); fetchAdminStats(); } catch (error) { if (adminUserError) adminUserError.textContent = `Failed to delete user: ${error.message}`; } finally { setButtonLoading(button, false); } }

     // --- Mobile Panel Toggle ---
     function handleMobileMenuToggle() {
          bodyElement.classList.toggle('left-panel-active');
     }
     function closeMobilePanel() {
          bodyElement.classList.remove('left-panel-active');
     }

     // --- Initialization Functions ---
     async function initializeApp() {
          switchState('loading');
          const initialTheme = getInitialTheme();
          applyTheme(initialTheme);
          let adminExists = null;
          try { adminExists = await checkSetupStatus(); } catch (e) { hideElement(loadingScreen); return; }
          if (adminExists === null) return;
          const savedUser = sessionStorage.getItem(SESSION_STORAGE_KEY);
          if (!adminExists) { switchState('onboarding'); return; }
          if (savedUser) { try { currentUser = JSON.parse(savedUser); console.log("Found saved session for:", currentUser.username); if (currentUser.isAdmin) { initializeAdminDashboard(); } else { initializeChatView(); } return; } catch (e) { console.error("Error parsing session:", e); sessionStorage.removeItem(SESSION_STORAGE_KEY); currentUser = null; } }
          switchState('login');
     }
     async function initializeChatView() { if (!currentUser) { logout(); return; } switchState('chat'); if (myUsernameSummary) myUsernameSummary.textContent = escapeHtml(currentUser.username); clearChatView(); await fetchBlockedUsers(); await fetchConversationsAndUsers(); connectWebSocket(); }
     async function initializeAdminDashboard() { if (!currentUser) { logout(); return; } switchState('admin'); if (adminUsernameDisplay) adminUsernameDisplay.textContent = escapeHtml(currentUser.username); await fetchAdminStats(); await fetchAdminUsers(); connectWebSocket(); updateAdminActiveUsers(); }

     // --- Event Listeners Setup ---
     function attachEventListeners() {
          // Onboarding
          onboardingForm?.addEventListener('submit', handleOnboardingSubmit);
          // Login / Register / Tabs
          userLoginForm?.addEventListener('submit', handleUserLoginSubmit);
          adminLoginForm?.addEventListener('submit', handleAdminLoginSubmit);
          registerForm?.addEventListener('submit', handleRegisterSubmit);
          showRegisterButton?.addEventListener('click', showRegisterForm);
          showLoginButton?.addEventListener('click', showUserLoginForm);
          userLoginTab?.addEventListener('click', showUserLoginForm);
          adminLoginTab?.addEventListener('click', showAdminLoginForm);
          switchToUserLoginButtons?.forEach(btn => btn.addEventListener('click', showUserLoginForm));
          // Global Error Banner
          errorBannerClose?.addEventListener('click', hideError);
          // Confirmation Modal
          confirmYesButton?.addEventListener('click', () => handleConfirmation(true));
          confirmNoButton?.addEventListener('click', () => handleConfirmation(false));
          confirmationModal?.addEventListener('click', (e) => { if (e.target === confirmationModal) handleConfirmation(false); });
          document.addEventListener('keydown', (e) => { if (confirmationModal?.style.display !== 'none' && e.key === 'Escape') handleConfirmation(false); });
          // Chat App - Left Panel
          logoutButton?.addEventListener('click', logout);
          createGroupButton?.addEventListener('click', openCreateGroupModal);
          manageBlocksButton?.addEventListener('click', openManageBlocksModal);
          themeToggleButton?.addEventListener('click', handleThemeToggle);
          conversationSearch?.addEventListener('input', debounce((e) => { const searchTerm = e.target.value.toLowerCase().trim(); const listItems = conversationListArea.querySelectorAll('.conversation-item'); listItems.forEach(item => { const name = item.querySelector('.conversation-name')?.textContent.toLowerCase() || ''; const isMatch = name.includes(searchTerm); item.style.display = isMatch ? 'flex' : 'none'; }); }, 250));
          // Chat App - Right Panel
          mobileMenuToggle?.addEventListener('click', handleMobileMenuToggle); // Hamburger click
          panelOverlay?.addEventListener('click', closeMobilePanel); // Overlay click
          sendButton?.addEventListener('click', handleSendMessage);
          messageInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } else { sendTypingIndicator(true); } });
          messageInput?.addEventListener('input', debounce(adjustTextareaHeight, 50));
          messageInput?.addEventListener('blur', () => { sendTypingIndicator(false); });
          refreshMessagesButton?.addEventListener('click', () => { if (currentConversationId) fetchMessagesForConversation(currentConversationId); });
          blockUserButton?.addEventListener('click', handleBlockUserFromHeader);
          deleteGroupButton?.addEventListener('click', handleDeleteGroup);
          // Create Group Modal
          createGroupForm?.addEventListener('submit', handleCreateGroupSubmit);
          createGroupModal?.querySelector('.modal-close-button')?.addEventListener('click', closeCreateGroupModal);
          createGroupModal?.addEventListener('click', (e) => { if (e.target === createGroupModal) closeCreateGroupModal(); });
          // Manage Blocks Modal
          manageBlocksModal?.querySelector('.modal-close-button')?.addEventListener('click', closeManageBlocksModal);
          manageBlocksModal?.addEventListener('click', (e) => { if (e.target === manageBlocksModal) closeManageBlocksModal(); });
          // Admin Dashboard
          adminLogoutButton?.addEventListener('click', logout);
          adminAddUserForm?.addEventListener('submit', handleAdminAddUserSubmit);
          adminThemeToggleButton?.addEventListener('click', handleThemeToggle);
     }

     // --- Start Application ---
     attachEventListeners();
     initializeApp();

});