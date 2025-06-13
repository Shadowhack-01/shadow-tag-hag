import { supabase } from './supabaseClient.js';

let currentUser = null;
let notificationSound = new Audio('assets/sounds/notification.mp3');

async function initializeNotifications() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
        window.location.href = 'login.html';
        return;
    }
    currentUser = user;
    await setupNotificationListeners();
    await loadNotifications();
    updateOnlineStatus();
}

function setupNotificationListeners() {
    const notificationsBtn = document.getElementById('notificationsBtn');
    const container = document.getElementById('notificationsContainer');
    const closeBtn = document.querySelector('.close-notifications');

    notificationsBtn?.addEventListener('click', () => {
        container.style.display = 'block';
        document.body.style.overflow = 'hidden';
        markNotificationsAsRead();
    });

    closeBtn?.addEventListener('click', () => {
        container.style.display = 'none';
        document.body.style.overflow = '';
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && container.style.display === 'block') {
            container.style.display = 'none';
            document.body.style.overflow = '';
        }
    });

    document.querySelector('.mark-all-read')?.addEventListener('click', markNotificationsAsRead);

    // Real-time notifications
    supabase
        .channel('notifications')
        .on('postgres_changes', 
            { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'notifications', 
                filter: `user_id=eq.${currentUser.id}` 
            },
            (payload) => {
                notificationSound.play().catch(() => {});
                updateNotificationBadge();
                loadNotifications();
                showNotificationToast(payload.new);
            }
        )
        .subscribe();
}

async function loadNotifications() {
    const notificationsList = document.getElementById('notificationsList');
    if (!notificationsList) return;

    const { data: notifications, error } = await supabase
        .from('notifications')
        .select(`
            *,
            sender:sender_id (
                nickname,
                avatar_url
            )
        `)
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        showEmptyState('Failed to load notifications');
        return;
    }

    if (!notifications || notifications.length === 0) {
        showEmptyState();
        return;
    }

    notificationsList.innerHTML = '';
    let lastDate = null;

    notifications.forEach(notification => {
        const notificationDate = new Date(notification.created_at).toLocaleDateString();
        
        if (notificationDate !== lastDate) {
            const dateDiv = document.createElement('div');
            dateDiv.className = 'notification-date';
            dateDiv.textContent = formatDate(notification.created_at);
            notificationsList.appendChild(dateDiv);
            lastDate = notificationDate;
        }

        const notificationItem = document.createElement('div');
        notificationItem.className = `notification-item${notification.is_read ? '' : ' unread'}`;
        notificationItem.innerHTML = `
            <img src="${notification.sender?.avatar_url || 'assets/images/default-avatar.png'}" 
                class="notification-avatar" 
                alt="Profile picture"
                onerror="this.src='assets/images/default-avatar.png'">
            <div class="notification-content">
                <p class="notification-text">${formatNotificationContent(notification)}</p>
                <div class="notification-time">${timeAgo(notification.created_at)}</div>
            </div>
            ${notification.type === 'post_like' || notification.type === 'comment' ? 
              `<div class="notification-preview">
                   <img src="${notification.preview_image || ''}" alt="Post preview">
               </div>` : ''
            }
        `;

        notificationItem.addEventListener('click', () => handleNotificationClick(notification));
        notificationsList.appendChild(notificationItem);
    });

    updateNotificationBadge();
}

function showEmptyState(message = 'No notifications yet') {
    const notificationsList = document.getElementById('notificationsList');
    notificationsList.innerHTML = `
        <div class="empty-notifications">
            <i class="far fa-bell"></i>
            <p><strong>${message}</strong></p>
            <p>When someone likes or comments on your posts, you'll see them here.</p>
        </div>
    `;
}

function formatNotificationContent(notification) {
    const senderName = notification.sender?.nickname || 'Someone';
    switch (notification.type) {
        case 'post_like':
            return `<strong>${senderName}</strong> liked your post`;
        case 'comment':
            return `<strong>${senderName}</strong> commented on your post: "${notification.content}"`;
        case 'follow':
            return `<strong>${senderName}</strong> started following you`;
        default:
            return notification.content;
    }
}

function handleNotificationClick(notification) {
    switch (notification.type) {
        case 'post_like':
        case 'comment':
            window.location.href = `post.html?id=${notification.related_id}`;
            break;
        case 'follow':
            window.location.href = `profile.html?id=${notification.sender_id}`;
            break;
    }
}

function showNotificationToast(notification) {
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.innerHTML = `
        <img src="${notification.sender?.avatar_url || 'assets/images/default-avatar.png'}" 
             alt="Profile picture">
        <div class="toast-content">
            <p>${formatNotificationContent(notification)}</p>
            <small>${timeAgo(notification.created_at)}</small>
        </div>
    `;

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }, 100);
}

async function markNotificationsAsRead() {
    const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', currentUser.id)
        .eq('is_read', false);

    if (!error) {
        updateNotificationBadge();
        loadNotifications();
    }
}

async function updateNotificationBadge() {
    const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact' })
        .eq('user_id', currentUser.id)
        .eq('is_read', false);

    if (!error) {
        const badge = document.querySelector('.notification-badge');
        if (badge) {
            badge.style.display = count > 0 ? 'block' : 'none';
            badge.textContent = count > 99 ? '99+' : count;
        }
    }
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString('en-US', { 
            month: 'long', 
            day: 'numeric',
            year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
        });
    }
}

function timeAgo(timestamp) {
    const seconds = Math.floor((new Date() - new Date(timestamp)) / 1000);
    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };
    
    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
        }
    }
    return 'just now';
}

function updateOnlineStatus() {
    if (document.visibilityState === 'visible') {
        supabase
            .from('users')
            .update({ last_seen: new Date().toISOString() })
            .eq('id', currentUser.id)
            .then(() => {
                setTimeout(updateOnlineStatus, 60000); // Update every minute
            });
    }
}

document.addEventListener('DOMContentLoaded', initializeNotifications);
document.addEventListener('visibilitychange', updateOnlineStatus);