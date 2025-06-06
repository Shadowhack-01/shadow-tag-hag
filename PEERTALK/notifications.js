import { supabase } from './supabaseClient.js';
     let currentUser = null;

        async function initializeNotifications() {
            const { data: { user }, error } = await supabase.auth.getUser();
            if (error || !user) return;
            currentUser = user;
            setupNotificationListeners();
            await loadNotifications();
        }

        function setupNotificationListeners() {
            const notificationsBtn = document.getElementById('notificationsBtn');
            const container = document.getElementById('notificationsContainer');
            notificationsBtn?.addEventListener('click', () => {
                container.style.display = container.style.display === 'none' ? 'block' : 'none';
                if (container.style.display === 'block') {
                    markNotificationsAsRead();
                }
            });
            document.addEventListener('click', (e) => {
                if (!container.contains(e.target) && !notificationsBtn.contains(e.target)) {
                    container.style.display = 'none';
                }
            });
            document.querySelector('.mark-all-read').addEventListener('click', markNotificationsAsRead);

            supabase
                .channel('notifications')
                .on('postgres_changes', 
                    { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` },
                    () => {
                        updateNotificationBadge();
                        loadNotifications();
                    }
                )
                .subscribe();
        }

        async function loadNotifications() {
            const notificationsList = document.getElementById('notificationsList');
            const { data: notifications, error } = await supabase
                .from('notifications')
                .select('*,sender:sender_id(nickname,avatar_url)')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) {
                notificationsList.innerHTML = '<div style="padding:10px;color:#c00;">Failed to load notifications.</div>';
                return;
            }

            notificationsList.innerHTML = notifications.length ? '' : 
                '<div style="padding:10px;color:#888;">No notifications yet</div>';

            notifications.forEach(notification => {
                const notificationItem = document.createElement('div');
                notificationItem.className = `notification-item${notification.is_read ? '' : ' unread'}`;
                notificationItem.innerHTML = `
                    <img src="${notification.sender?.avatar_url || 'assets/images/default-avatar.png'}" 
                        class="notification-avatar" alt="">
                    <div class="notification-content">
                        <p class="notification-text">${notification.content}</p>
                        <div class="notification-time">${timeAgo(notification.created_at)}</div>
                    </div>
                `;
                notificationsList.appendChild(notificationItem);
            });

            updateNotificationBadge();
        }

        async function markNotificationsAsRead() {
            await supabase
                .from('notifications')
                .update({ is_read: true })
                .eq('user_id', currentUser.id)
                .eq('is_read', false);
            updateNotificationBadge();
            loadNotifications();
        }

        async function updateNotificationBadge() {
            const { count } = await supabase
                .from('notifications')
                .select('id', { count: 'exact' })
                .eq('user_id', currentUser.id)
                .eq('is_read', false);

            const badge = document.querySelector('.notification-badge');
            if (badge) {
                badge.style.display = count > 0 ? 'block' : 'none';
                badge.textContent = count;
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

        document.addEventListener('DOMContentLoaded', initializeNotifications);