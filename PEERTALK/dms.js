import { supabase } from './supabaseClient.js';

let currentUser = null;
let currentChat = null;
let messageSubscription = null;
let typingTimeout = null;
let lastTypingStatus = null;

// Initialize DMs
async function initializeDMs() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
        window.location.href = 'login.html';
        return;
    }
    currentUser = user;

    // Update nickname display
    document.querySelector('.user-nickname').textContent = 
        user.user_metadata?.nickname || user.email;

    // Set up new chat button
    document.getElementById('newChatBtn').addEventListener('click', showNewChatModal);
    
    // Set up modal close button
    document.querySelector('.close-modal').addEventListener('click', () => {
        document.getElementById('newChatModal').style.display = 'none';
    });

    // Set up user search with debounce
    document.getElementById('userSearch').addEventListener('input', 
        debounce(searchUsers, 300)
    );

    // Close modal on outside click
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('newChatModal');
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    // Load existing chats and friends
    await loadChats();
    await loadFriendsForChatList();

    // Subscribe to new messages and presence
    subscribeToNewMessages();
    subscribeToPresence();

    // Fetch friend requests
    fetchFriendRequests();

    // If a chat is selected in URL, open it
    const params = new URLSearchParams(window.location.search);
    const chatId = params.get('chat_id');
    if (chatId) {
        setTimeout(() => {
            const chatItem = document.querySelector(`[data-chat-id="${chatId}"]`);
            if (chatItem) chatItem.click();
        }, 300);
    }
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function showNewChatModal() {
    const modal = document.getElementById('newChatModal');
    modal.style.display = 'block';
    document.getElementById('userSearch').focus();
}

async function searchUsers(event) {
    const searchTerm = event.target.value.trim();
    const usersList = document.getElementById('usersList');
    
    if (!searchTerm) {
        usersList.innerHTML = '';
        return;
    }

    const { data: users, error } = await supabase
        .from('users')
        .select('id, nickname, avatar_url, email, last_seen')
        .neq('id', currentUser.id)
        .or(`nickname.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
        .limit(10);

    if (error) {
        console.error('Error searching users:', error);
        return;
    }

    // For each user, check friend request status
    for (const user of users) {
        user.friendStatus = await getFriendStatus(user.id);
    }

    usersList.innerHTML = users.map(user => `
        <div class="user-item" data-user-id="${user.id}">
            <img src="${user.avatar_url || 'assets/images/default-avatar.png'}" 
                 alt="User Avatar" 
                 class="chat-avatar"
                 onerror="this.src='assets/images/default-avatar.png'">
            <span>${user.nickname || user.email}</span>
            ${renderFriendButton(user)}
        </div>
    `).join('');

    // Attach event listeners for Add Friend buttons
    usersList.querySelectorAll('.add-friend-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const receiverId = btn.getAttribute('data-user-id');
            sendFriendRequest(receiverId, btn);
        });
    });

    // Optionally, clicking the user-item (not the button) can start a chat
    usersList.querySelectorAll('.user-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('add-friend-btn')) return;
            startNewChat(item.dataset.userId);
        });
    });
}

function renderFriendButton(user) {
    if (user.friendStatus === 'pending') {
        return `<button class="add-friend-btn" data-user-id="${user.id}" disabled>Pending</button>`;
    }
    if (user.friendStatus === 'accepted') {
        return `<button class="add-friend-btn" data-user-id="${user.id}" disabled>Friends</button>`;
    }
    return `<button class="add-friend-btn" data-user-id="${user.id}">Add Friend</button>`;
}

async function getFriendStatus(otherUserId) {
    // Check if already friends or request pending
    const { data: existing } = await supabase
        .from('friend_requests')
        .select('id, status, sender_id, receiver_id')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: false })
        .limit(1);
    if (existing && existing.length > 0) {
        return existing[0].status;
    }
    // Check if already friends
    const { data: friends } = await supabase
        .from('friends')
        .select('id')
        .or(`and(user1_id.eq.${currentUser.id},user2_id.eq.${otherUserId}),and(user1_id.eq.${otherUserId},user2_id.eq.${currentUser.id})`)
        .limit(1);
    if (friends && friends.length > 0) {
        return 'accepted';
    }
    return null;
}

async function sendFriendRequest(receiverId, btn) {
    // Prevent sending to self
    if (receiverId === currentUser.id) {
        alert("You can't add yourself as a friend.");
        return;
    }
    // Check if already friends or request pending
    const { data: existing } = await supabase
        .from('friend_requests')
        .select('id, status')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${currentUser.id})`)
        .in('status', ['pending', 'accepted']);
    if (existing && existing.length > 0) {
        alert('Friend request already sent or you are already friends.');
        return;
    }
    const { error } = await supabase
        .from('friend_requests')
        .insert([{ sender_id: currentUser.id, receiver_id: receiverId, status: 'pending' }]);
    if (error) {
        alert('Error sending friend request: ' + error.message);
    } else {
        if (btn) {
            btn.textContent = 'Pending';
            btn.disabled = true;
        }
        alert('Friend request sent!');
        fetchFriendRequests();
    }
}

async function fetchFriendRequests() {
    const { data, error } = await supabase
        .from('friend_requests')
        .select('id, sender_id, status, sender:sender_id(nickname,avatar_url)')
        .eq('receiver_id', currentUser.id)
        .eq('status', 'pending');
    const container = document.getElementById('friendRequests');
    container.innerHTML = '';
    if (data && data.length > 0) {
        data.forEach(req => {
            const div = document.createElement('div');
            div.innerHTML = `
                <img src="${req.sender?.avatar_url || 'assets/images/default-avatar.png'}" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:6px;">
                <span><b>${req.sender?.nickname || req.sender_id}</b> sent you a friend request.</span>
                <button onclick="window.respondToFriendRequest('${req.id}', true)">Accept</button>
                <button class="reject" onclick="window.respondToFriendRequest('${req.id}', false)">Reject</button>
            `;
            container.appendChild(div);
        });
    }
}
window.respondToFriendRequest = async function(requestId, accept) {
    await supabase
        .from('friend_requests')
        .update({ status: accept ? 'accepted' : 'rejected' })
        .eq('id', requestId);
    if (accept) {
        // Get the request to know both user IDs
        const { data: req } = await supabase
            .from('friend_requests')
            .select('*')
            .eq('id', requestId)
            .single();

        // Check if friendship already exists to avoid 409 conflict
        const { data: existing } = await supabase
            .from('friends')
            .select('id')
            .or(`and(user1_id.eq.${req.sender_id},user2_id.eq.${req.receiver_id}),and(user1_id.eq.${req.receiver_id},user2_id.eq.${req.sender_id})`)
            .limit(1);

        if (!existing || existing.length === 0) {
            await supabase.from('friends').insert([
                { user1_id: req.sender_id, user2_id: req.receiver_id },
                { user1_id: req.receiver_id, user2_id: req.sender_id }
            ]);
        }
        // Optionally, reload chats and friends
        await loadChats();
        await loadFriendsForChatList();
    }
    fetchFriendRequests(); // Refresh requests
};

async function startNewChat(userId) {
    // Check if chat already exists between these two users
    const { data: existingChats } = await supabase
        .from('chats')
        .select('id, chat_participants!inner(user_id)')
        .in('chat_participants.user_id', [currentUser.id, userId]);

    let chatId;
    if (existingChats && existingChats.length > 0) {
        chatId = existingChats[0].id;
    } else {
        // Create new chat
        const { data: newChat, error } = await supabase
            .from('chats')
            .insert([{}])
            .select()
            .single();

        if (error) {
            alert('Error creating chat: ' + error.message);
            return;
        }

        chatId = newChat.id;

        // Add both users as participants
        await supabase.from('chat_participants').insert([
            { chat_id: chatId, user_id: currentUser.id },
            { chat_id: chatId, user_id: userId }
        ]);
    }

    // Close modal and open chat
    document.getElementById('newChatModal').style.display = 'none';
    await loadChats();
    await loadFriendsForChatList();
    // Update URL for refresh persistence
    window.history.replaceState({}, '', `?chat_id=${chatId}`);
    const chatItem = document.querySelector(`[data-chat-id="${chatId}"]`);
    if (chatItem) chatItem.click();
}

async function loadChats() {
    // Only show chats with users who are friends (accepted)
    const { data: friendsData } = await supabase
        .from('friends')
        .select('user1_id, user2_id')
        .or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`);
    const friendIds = new Set();
    if (friendsData) {
        friendsData.forEach(f => {
            if (f.user1_id !== currentUser.id) friendIds.add(f.user1_id);
            if (f.user2_id !== currentUser.id) friendIds.add(f.user2_id);
        });
    }

    const { data: chats, error } = await supabase
        .from('chats')
        .select(`
            *,
            participants:chat_participants(user_id),
            last_message:messages(content, created_at, user_id),
            unread_count:messages(count)
        `)
        .eq('participants.user_id', currentUser.id)
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('Error loading chats:', error);
        return;
    }

    const chatsList = document.querySelector('.chats-list');
    chatsList.querySelectorAll('.chat-item').forEach(e => e.remove());

    for (const chat of chats) {
        const otherParticipantId = chat.participants
            .find(p => p.user_id !== currentUser.id)?.user_id;

        if (!otherParticipantId || !friendIds.has(otherParticipantId)) continue;

        const { data: userData } = await supabase
            .from('users')
            .select('nickname, avatar_url, last_seen')
            .eq('id', otherParticipantId)
            .single();

        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item';
        chatItem.dataset.chatId = chat.id;
        
        const lastMessage = chat.last_message?.[0];
        const unreadCount = chat.unread_count?.[0]?.count || 0;
        
        chatItem.innerHTML = `
            <div class="chat-avatar-wrapper">
                <img src="${userData?.avatar_url || 'assets/images/default-avatar.png'}" 
                     alt="Chat Avatar" 
                     class="chat-avatar"
                     onerror="this.src='assets/images/default-avatar.png'">
                <div class="user-status ${getOnlineStatus(userData?.last_seen)}"></div>
            </div>
            <div class="chat-info">
                <div class="chat-meta">
                    <div class="chat-name">${userData?.nickname || 'User'}</div>
                    <div class="chat-time">${lastMessage ? timeAgo(lastMessage.created_at) : ''}</div>
                </div>
                <div class="chat-preview">
                    ${lastMessage ? lastMessage.content : 'No messages yet'}
                    ${unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : ''}
                </div>
            </div>
        `;

        chatItem.addEventListener('click', () => {
            window.history.replaceState({}, '', `?chat_id=${chat.id}`);
            openChat(chat.id, userData);
        });
        chatsList.appendChild(chatItem);
    }
    // After loading chats, also show all friends (even if no chat exists)
    await loadFriendsForChatList(friendIds);
}

async function loadFriendsForChatList(existingFriendIdsSet = null) {
    // Fetch all friends
    const { data: friendsData } = await supabase
        .from('friends')
        .select('user1_id, user2_id')
        .or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`);
    const friendIds = [];
    if (friendsData) {
        friendsData.forEach(f => {
            if (f.user1_id !== currentUser.id) friendIds.push(f.user1_id);
            if (f.user2_id !== currentUser.id) friendIds.push(f.user2_id);
        });
    }
    if (friendIds.length > 0) {
        const { data: users } = await supabase
            .from('users')
            .select('id, nickname, avatar_url, last_seen')
            .in('id', friendIds);

        const chatsList = document.querySelector('.chats-list');
        users.forEach(user => {
            // If already rendered by chat, skip
            if (existingFriendIdsSet && existingFriendIdsSet.has(user.id)) return;
            const friendDiv = document.createElement('div');
            friendDiv.className = 'chat-item friend-highlight';
            friendDiv.innerHTML = `
                <div class="chat-avatar-wrapper">
                    <img src="${user.avatar_url || 'assets/images/default-avatar.png'}" class="chat-avatar">
                    <div class="user-status ${getOnlineStatus(user.last_seen)}"></div>
                </div>
                <div class="chat-info">
                    <div class="chat-name">${user.nickname || 'User'}</div>
                    <div class="chat-preview"><span class="new-friend-badge">New Friend</span> Start a chat</div>
                </div>
            `;
            friendDiv.addEventListener('click', () => startNewChat(user.id));
            chatsList.appendChild(friendDiv);
        });
    }
}

function getOnlineStatus(lastSeen) {
    if (!lastSeen) return 'offline';
    const lastSeenDate = new Date(lastSeen);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60000);
    return lastSeenDate > fiveMinutesAgo ? 'online' : 'offline';
}

function timeAgo(timestamp) {
    const seconds = Math.floor((new Date() - new Date(timestamp)) / 1000);
    
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + 'y';
    
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + 'mo';
    
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + 'd';
    
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + 'h';
    
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + 'm';
    
    return 'now';
}

async function openChat(chatId, otherUser) {
    // Update active chat styling
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.chatId === chatId) {
            item.classList.add('active');
        }
    });

    currentChat = { id: chatId, otherUser };

    // Create chat window
    const chatWindow = document.querySelector('.chat-window');
    chatWindow.innerHTML = `
        <div class="chat-header">
            <div class="chat-avatar-wrapper">
                <img src="${otherUser?.avatar_url || 'assets/images/default-avatar.png'}" 
                     alt="Chat Avatar" 
                     class="chat-avatar"
                     onerror="this.src='assets/images/default-avatar.png'">
                <div class="user-status ${getOnlineStatus(otherUser?.last_seen)}"></div>
            </div>
            <div class="chat-info">
                <div class="chat-name">${otherUser?.nickname || 'User'}</div>
                <div class="chat-status" id="typingStatus"></div>
            </div>
        </div>
        <div class="chat-messages"></div>
        <div class="chat-input">
            <input type="text" placeholder="Type a message...">
            <button>
                <i class="fas fa-paper-plane"></i>
                <span>Send</span>
            </button>
        </div>
    `;

    // Mark messages as read
    await supabase
        .from('messages')
        .update({ read: true })
        .eq('chat_id', chatId)
        .neq('user_id', currentUser.id);

    // Load messages
    await loadMessages(chatId);

    // Set up message input
    const input = chatWindow.querySelector('input');
    const sendBtn = chatWindow.querySelector('button');

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input.value);
        }
    });

    input.addEventListener('input', () => {
        if (typingTimeout) clearTimeout(typingTimeout);
        updateTypingStatus(chatId, true);
        typingTimeout = setTimeout(() => updateTypingStatus(chatId, false), 2000);
    });

    sendBtn.addEventListener('click', () => {
        sendMessage(input.value);
    });
}

async function updateTypingStatus(chatId, isTyping) {
    if (lastTypingStatus === isTyping) return;
    lastTypingStatus = isTyping;
    
    await supabase
        .from('chat_typing')
        .upsert([{
            chat_id: chatId,
            user_id: currentUser.id,
            is_typing: isTyping
        }]);
}

async function loadMessages(chatId) {
    const { data: messages, error } = await supabase
        .from('messages')
        .select('*, user:user_id(nickname)')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error loading messages:', error);
        return;
    }

    const messagesContainer = document.querySelector('.chat-messages');
    messagesContainer.innerHTML = '';

    let lastDate = null;

    messages.forEach(message => {
        const messageDate = new Date(message.created_at).toLocaleDateString();
        
        if (messageDate !== lastDate) {
            const dateDiv = document.createElement('div');
            dateDiv.className = 'message-date';
            dateDiv.textContent = messageDate;
            messagesContainer.appendChild(dateDiv);
            lastDate = messageDate;
        }

        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.user_id === currentUser.id ? 'sent' : 'received'}`;
        messageElement.innerHTML = `
            <div class="message-content">
                ${message.content}
            </div>
            <div class="message-time">
                ${new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
        `;
        messagesContainer.appendChild(messageElement);
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function sendMessage(content) {
    if (!content.trim() || !currentChat) return;

    const input = document.querySelector('.chat-input input');
    input.value = '';

    const { error } = await supabase
        .from('messages')
        .insert([{
            chat_id: currentChat.id,
            user_id: currentUser.id,
            content: content.trim(),
            read: false
        }]);

    if (error) {
        console.error('Error sending message:', error);
        alert('Failed to send message');
        return;
    }

    await supabase
        .from('chats')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', currentChat.id);

    updateTypingStatus(currentChat.id, false);
}

function subscribeToNewMessages() {
    if (messageSubscription) {
        messageSubscription.unsubscribe();
    }

    messageSubscription = supabase
        .channel('messages')
        .on('postgres_changes', 
            { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'messages' 
            }, 
            payload => {
                if (payload.new.chat_id === currentChat?.id) {
                    loadMessages(currentChat.id);
                }
                loadChats();
                loadFriendsForChatList();
            }
        )
        .on('postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'chat_typing'
            },
            payload => {
                if (payload.new.chat_id === currentChat?.id && 
                    payload.new.user_id !== currentUser.id) {
                    const typingStatus = document.getElementById('typingStatus');
                    if (typingStatus) {
                        typingStatus.textContent = payload.new.is_typing ? 'typing...' : '';
                    }
                }
            }
        )
        .subscribe();
}

function subscribeToPresence() {
    supabase.channel('online-users')
        .on('presence', { event: 'sync' }, () => {
            // Update online status indicators
            document.querySelectorAll('.user-status').forEach(status => {
                const userId = status.closest('[data-user-id]')?.dataset.userId;
                if (userId) {
                    status.className = `user-status ${getOnlineStatus(userId)}`;
                }
            });
        })
        .subscribe();
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeDMs);