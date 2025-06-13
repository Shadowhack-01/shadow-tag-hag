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

    // Load existing chats
    await loadChats();

    // Subscribe to new messages and presence
    subscribeToNewMessages();
    subscribeToPresence();
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

    usersList.innerHTML = users.map(user => `
        <div class="user-item" data-user-id="${user.id}">
            <div class="chat-avatar-wrapper">
                <img src="${user.avatar_url || 'assets/images/default-avatar.png'}" 
                     alt="User Avatar" 
                     class="chat-avatar"
                     onerror="this.src='assets/images/default-avatar.png'">
                <div class="user-status ${getOnlineStatus(user.last_seen)}"></div>
            </div>
            <div class="chat-info">
                <div class="chat-name">${user.nickname || user.email}</div>
                <div class="chat-preview">${user.last_seen ? timeAgo(user.last_seen) : 'Offline'}</div>
            </div>
        </div>
    `).join('');

    usersList.querySelectorAll('.user-item').forEach(item => {
        item.addEventListener('click', () => startNewChat(item.dataset.userId));
    });
}

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
    const chatItem = document.querySelector(`[data-chat-id="${chatId}"]`);
    if (chatItem) chatItem.click();
}

async function loadChats() {
    const { data: chats, error } = await supabase
        .from('chats')
        .select(`
            *,
            participants:chat_participants(user_id),
            last_message:messages(content, created_at, user_id),
            unread_count:messages(count)
        `)
        .eq('participants.user_id', currentUser.id)
        .eq('messages.read', false)
        .neq('messages.user_id', currentUser.id)
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('Error loading chats:', error);
        return;
    }

    const chatsList = document.querySelector('.chats-list');
    chatsList.innerHTML = '';

    for (const chat of chats) {
        const otherParticipantId = chat.participants
            .find(p => p.user_id !== currentUser.id)?.user_id;

        if (!otherParticipantId) continue;

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

        chatItem.addEventListener('click', () => openChat(chat.id, userData));
        chatsList.appendChild(chatItem);
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