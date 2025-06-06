import { supabase } from './supabaseClient.js';

// Array to store all currently displayed stories for modal navigation
let allDisplayedStories = [];
let currentStoryIndex = -1;
let storyTimer = null;
const STORY_DURATION = 5000;

// --- Get Modal Elements ---
const storyModalOverlay = document.querySelector('.story-modal-overlay');
const storyModalContent = document.querySelector('.story-modal-content');
const storyMediaContainer = document.querySelector('.story-media-container');
const storyUserAvatar = document.querySelector('.story-user-avatar');
const storyUsername = document.querySelector('.story-username');
const storyProgressBarContainer = document.querySelector('.story-progress-bar-container');
const storyPrevButton = document.querySelector('.story-prev-button');
const storyNextButton = document.querySelector('.story-next-button');
const storyCloseButton = document.querySelector('.story-close-button');

// Modal elements for editing posts
const editPostModal = document.getElementById('editPostModal');
const editPostContent = document.getElementById('editPostContent');
const saveEditButton = document.getElementById('saveEditButton');

// Story views modal
const storyViewsModal = document.getElementById('storyViewsModal');
const storyViewsList = storyViewsModal ? storyViewsModal.querySelector('.views-list') : null;

let currentEditingPostId = null;

// Utility: fallback image for missing images
function setDefaultImage(img) {
  img.onerror = null;
  img.src = 'assets/images/default-avatar.png';
}

// --- STORY VIEW TRACKING ---
async function logStoryView(story) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id === story.user_id) return; // Don't log for owner or not logged in
    await supabase.from('story_views').upsert([
        { story_id: story.id, user_id: user.id }
    ], { onConflict: ['story_id', 'user_id'] });
}

// --- STORY VIEWS MODAL LOGIC ---
async function showStoryViewsModal(story) {
    if (!storyViewsModal || !storyViewsList) return;
    storyViewsModal.style.display = 'block';
    storyViewsList.innerHTML = '<li>Loading...</li>';

    // Get current user
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) {
        storyViewsList.innerHTML = '<li>You do not have permission to see viewers.</li>';
        return;
    }

    // Only owner can see
    if (currentUser.id !== story.user_id) {
        storyViewsList.innerHTML = '<li>You do not have permission to see viewers.</li>';
        return;
    }

    // Use explicit foreign key join for story_views.user_id -> users.id
    const { data, error } = await supabase
        .from('story_views')
        .select(`
            user_id,
            users!story_views_user_id_fkey (
                nickname,
                avatar_url
            )
        `)
        .eq('story_id', story.id)
        .order('viewed_at', { ascending: false });

    if (error || !data || data.length === 0) {
        storyViewsList.innerHTML = '<li>No views yet</li>';
        return;
    }

    storyViewsList.innerHTML = data.map(v => `
        <li style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
            <img src="${v.users?.avatar_url || 'assets/images/default-avatar.png'}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">
            <span>${v.users?.nickname || v.user_id}</span>
        </li>
    `).join('');
}

// Close story views modal on button click
if (storyViewsModal) {
    const closeBtn = storyViewsModal.querySelector('button');
    if (closeBtn) {
        closeBtn.onclick = () => {
            storyViewsModal.style.display = 'none';
        };
    }
}

// Function to create a story card HTML element
function createStoryCardElement(storyData, nickname, avatarUrl = 'assets/images/default-avatar.png') {
    const storyCard = document.createElement('div');
    storyCard.classList.add('story-card');
    storyCard.dataset.storyId = storyData.id;
    storyCard.dataset.userId = storyData.user_id;

    let mediaUrl = '';
    if (storyData.media_url) {
        mediaUrl = storyData.media_url;
    } else if (storyData.storage_path) {
        const { data: publicUrlData } = supabase.storage
            .from('story-uploads')
            .getPublicUrl(storyData.storage_path);
        mediaUrl = publicUrlData.publicUrl;
    }

    const isVideo = mediaUrl.toLowerCase().endsWith('.mp4') || mediaUrl.toLowerCase().endsWith('.webm') || mediaUrl.toLowerCase().endsWith('.ogg');

    storyCard.innerHTML = `
        ${isVideo ?
            `<video src="${mediaUrl}" alt="Story Video" class="story-media"></video>` :
            `<img src="${mediaUrl}" alt="Story Image" class="story-media" onerror="this.src='assets/images/default-avatar.png'">`
        }
        <img src="${avatarUrl}" alt="User Avatar" class="user-avatar" onerror="this.src='assets/images/default-avatar.png'">
        <span class="username">${nickname}</span>
    `;

    storyCard.addEventListener('click', () => {
        const clickedStoryIndex = allDisplayedStories.findIndex(story => story.id === storyData.id);
        if (clickedStoryIndex !== -1) {
             openFullScreenStoryView(clickedStoryIndex);
        }
    });

    return storyCard;
}

async function displayStory(index) {
    if (index < 0 || index >= allDisplayedStories.length) {
        closeFullScreenStoryView();
        return;
    }

    currentStoryIndex = index;
    const story = allDisplayedStories[currentStoryIndex];

    storyMediaContainer.innerHTML = '';

    let mediaUrl = '';
    if (story.media_url) {
        mediaUrl = story.media_url;
    } else if (story.storage_path) {
        mediaUrl = supabase.storage.from('story-uploads').getPublicUrl(story.storage_path).data.publicUrl;
    }
    const isVideo = mediaUrl.toLowerCase().endsWith('.mp4') || mediaUrl.toLowerCase().endsWith('.webm') || mediaUrl.toLowerCase().endsWith('.ogg');

    if (isVideo) {
        const videoElement = document.createElement('video');
        videoElement.src = mediaUrl;
        videoElement.controls = false;
        videoElement.autoplay = true;
        videoElement.muted = true;
        videoElement.playsInline = true;
        videoElement.classList.add('story-media');
        storyMediaContainer.appendChild(videoElement);

        videoElement.addEventListener('loadedmetadata', startStoryTimer);
        videoElement.addEventListener('play', startStoryTimer);
        videoElement.addEventListener('pause', stopStoryTimer);
        videoElement.addEventListener('ended', nextStory);
    } else {
        const imgElement = document.createElement('img');
        imgElement.src = mediaUrl;
        imgElement.alt = 'Story Image';
        imgElement.classList.add('story-media');
        imgElement.onerror = function() { setDefaultImage(this); };
        storyMediaContainer.appendChild(imgElement);

        startStoryTimer();
    }

    const nickname = story.user?.nickname || story.user?.email || 'User';
    storyUsername.textContent = nickname;
    if (storyUserAvatar) {
        storyUserAvatar.src = story.user?.avatar_url || 'assets/images/default-avatar.png';
        storyUserAvatar.onerror = function() { setDefaultImage(this); };
    }

    updateProgressBars();

    storyPrevButton.style.display = currentStoryIndex > 0 ? 'block' : 'none';
    storyNextButton.style.display = currentStoryIndex < allDisplayedStories.length - 1 ? 'block' : 'none';

    // Log view
    logStoryView(story);

    // Show viewers button if owner
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    let viewersBtn = document.getElementById('storyViewersBtn');
    if (viewersBtn) viewersBtn.remove();
    if (currentUser && currentUser.id === story.user_id) {
        viewersBtn = document.createElement('button');
        viewersBtn.id = 'storyViewersBtn';
        viewersBtn.innerHTML = `<i class="fas fa-eye"></i> <span class="story-views-count"></span>`;
        viewersBtn.style.position = 'absolute';
        viewersBtn.style.bottom = '20px';
        viewersBtn.style.right = '20px';
        viewersBtn.style.background = '#fff';
        viewersBtn.style.color = '#222';
        viewersBtn.style.border = 'none';
        viewersBtn.style.borderRadius = '8px';
        viewersBtn.style.padding = '8px 16px';
        viewersBtn.style.cursor = 'pointer';
        viewersBtn.style.zIndex = '20';
        viewersBtn.onclick = () => showStoryViewsModal(story);
        storyModalContent.appendChild(viewersBtn);

        // Fetch and show count
        const { count } = await supabase
            .from('story_views')
            .select('*', { count: 'exact', head: true })
            .eq('story_id', story.id);
        viewersBtn.querySelector('.story-views-count').textContent = count || 0;
    }
}

function startStoryTimer() {
    stopStoryTimer();
    const currentProgressBarFill = storyProgressBarContainer.children[currentStoryIndex]?.querySelector('.story-progress-fill');
    if (currentProgressBarFill) {
        currentProgressBarFill.style.transition = 'none';
        currentProgressBarFill.style.width = '0%';
        void currentProgressBarFill.offsetWidth;
        currentProgressBarFill.style.transition = `width ${STORY_DURATION}ms linear`;
        currentProgressBarFill.style.width = '100%';
    }
    storyTimer = setTimeout(() => {
        nextStory();
    }, STORY_DURATION);
}

function stopStoryTimer() {
    if (storyTimer) {
        clearTimeout(storyTimer);
        storyTimer = null;
        const currentProgressBarFill = storyProgressBarContainer.children[currentStoryIndex]?.querySelector('.story-progress-fill');
        if (currentProgressBarFill) {
            const computedStyle = getComputedStyle(currentProgressBarFill);
            const width = computedStyle.width;
            currentProgressBarFill.style.transition = 'none';
            currentProgressBarFill.style.width = width;
        }
    }
}

function nextStory() {
    stopStoryTimer();
    if (currentStoryIndex < allDisplayedStories.length - 1) {
        displayStory(currentStoryIndex + 1);
    } else {
        closeFullScreenStoryView();
    }
}

function prevStory() {
    stopStoryTimer();
    if (currentStoryIndex > 0) {
        displayStory(currentStoryIndex - 1);
    }
}

function updateProgressBars() {
    storyProgressBarContainer.innerHTML = '';
    allDisplayedStories.forEach((_, index) => {
        const progressBar = document.createElement('div');
        progressBar.classList.add('story-progress-bar');
        const progressFill = document.createElement('div');
        progressFill.classList.add('story-progress-fill');
        progressBar.appendChild(progressFill);
        storyProgressBarContainer.appendChild(progressBar);
        if (index < currentStoryIndex) {
            progressFill.style.width = '100%';
        } else if (index === currentStoryIndex) {
            // The displayStory function will handle animating the current one
        } else {
            progressFill.style.width = '0%';
        }
    });
}

function openFullScreenStoryView(startIndex = 0) {
    if (allDisplayedStories.length === 0) return;
    const validStartIndex = Math.max(0, Math.min(startIndex, allDisplayedStories.length - 1));
    displayStory(validStartIndex);
    storyModalOverlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeFullScreenStoryView() {
    stopStoryTimer();
    storyModalOverlay.classList.remove('visible');
    document.body.style.overflow = '';
    const videoElement = storyMediaContainer.querySelector('video');
    if (videoElement) videoElement.pause();
    let viewersBtn = document.getElementById('storyViewersBtn');
    if (viewersBtn) viewersBtn.remove();
    if (storyViewsModal) storyViewsModal.style.display = 'none';
}

async function fetchAndDisplayStories() {
    const storiesGrid = document.querySelector('.stories-grid');
    if (!storiesGrid) return;
    const existingStoryCards = storiesGrid.querySelectorAll('.story-card:not(.add-story)');
    existingStoryCards.forEach(card => card.remove());

    try {
        const { data: stories, error } = await supabase
            .from('stories')
            .select('*, user:user_id(nickname, avatar_url)')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching stories:', error.message);
            return;
        }

        allDisplayedStories = stories;

        const addStoryCard = storiesGrid.querySelector('.story-card.add-story');
        stories.forEach(story => {
            const nickname = story.user?.nickname || story.user?.email || 'User';
            const avatarUrl = story.user?.avatar_url || 'assets/images/default-avatar.png';
            const storyCardElement = createStoryCardElement(story, nickname, avatarUrl);
            if (addStoryCard) {
                storiesGrid.insertBefore(storyCardElement, addStoryCard.nextSibling);
            } else {
                storiesGrid.appendChild(storyCardElement);
            }
        });

    } catch (error) {
        console.error('An unexpected error occurred while fetching stories:', error);
    }
}

// --- POSTS SECTION ---

function timeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

// Helper to fetch counts and comments
async function fetchCounts(postId) {
    const [{ count: likeCount }, { count: shareCount }, { data: comments }] = await Promise.all([
        supabase.from('likes').select('*', { count: 'exact', head: true }).eq('post_id', postId),
        supabase.from('shares').select('*', { count: 'exact', head: true }).eq('post_id', postId),
        supabase.from('comments').select('*, user:user_id(nickname)').eq('post_id', postId)
    ]);
    return { likeCount: likeCount || 0, shareCount: shareCount || 0, comments: comments || [] };
}

// Modal for viewing media full screen
function createMediaModal(mediaUrl, isVideo = false) {
    let existing = document.getElementById('mediaModalOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mediaModalOverlay';
    overlay.style.position = 'fixed';
    overlay.style.top = 0;
    overlay.style.left = 0;
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.85)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = 9999;
    overlay.style.cursor = 'zoom-out';

    let mediaElem;
    if (isVideo) {
        mediaElem = document.createElement('video');
        mediaElem.src = mediaUrl;
        mediaElem.controls = true;
        mediaElem.autoplay = true;
        mediaElem.style.maxWidth = '90vw';
        mediaElem.style.maxHeight = '90vh';
        mediaElem.style.borderRadius = '12px';
        mediaElem.style.background = '#000';
    } else {
        mediaElem = document.createElement('img');
        mediaElem.src = mediaUrl;
        mediaElem.style.maxWidth = '90vw';
        mediaElem.style.maxHeight = '90vh';
        mediaElem.style.borderRadius = '12px';
        mediaElem.style.background = '#fff';
    }

    overlay.appendChild(mediaElem);

    overlay.addEventListener('click', () => {
        overlay.remove();
    });

    document.body.appendChild(overlay);
}

// Enhance post images/videos to open in full screen
function enablePostMediaFullScreen() {
    document.querySelectorAll('.post-image').forEach(img => {
        img.style.cursor = 'zoom-in';
        img.onclick = (e) => {
            e.stopPropagation();
            createMediaModal(img.src, false);
        };
    });
    document.querySelectorAll('.post-video').forEach(video => {
        video.style.cursor = 'zoom-in';
        video.onclick = (e) => {
            e.stopPropagation();
            createMediaModal(video.src, true);
        };
    });
}

// Show comment box with username
async function showCommentBox(card, post) {
    let commentBox = card.querySelector('.comment-box');
    if (commentBox) {
        commentBox.style.display = commentBox.style.display === 'none' ? 'block' : 'none';
        return;
    }
    commentBox = document.createElement('div');
    commentBox.className = 'comment-box';
    commentBox.style.marginTop = '1em';
    commentBox.innerHTML = `
        <input type="text" class="comment-input" placeholder="Write a comment..." style="width:80%;padding:0.5em;border-radius:6px;border:1px solid #eee;">
        <button class="comment-submit" style="padding:0.5em 1em;border:none;background:#1877f2;color:#fff;border-radius:6px;margin-left:0.5em;">Post</button>
        <div class="comments-list" style="margin-top:0.5em;"></div>
    `;
    card.appendChild(commentBox);

    const input = commentBox.querySelector('.comment-input');
    const submit = commentBox.querySelector('.comment-submit');
    const commentsList = commentBox.querySelector('.comments-list');

    // Load comments with usernames
    async function loadComments() {
        commentsList.innerHTML = '';
        const { data: comments } = await supabase
            .from('comments')
            .select('*, user:user_id(nickname)')
            .eq('post_id', post.id)
            .order('created_at', { ascending: true });
        (comments || []).forEach(c => {
            const comment = document.createElement('div');
            comment.innerHTML = `<strong>${c.user?.nickname || 'User'}:</strong> ${c.content}`;
            comment.style.background = '#f0f2f5';
            comment.style.borderRadius = '6px';
            comment.style.padding = '0.4em 0.8em';
            comment.style.margin = '0.2em 0';
            commentsList.appendChild(comment);
        });
        // Update comment count on the button
        if (card.updateCounts) card.updateCounts();
    }
    loadComments();

    submit.addEventListener('click', async () => {
        if (input.value.trim()) {
            const { data: { user: currentUser } } = await supabase.auth.getUser();
            if (!currentUser) return alert('Login to comment');
            await supabase.from('comments').insert([{
                post_id: post.id,
                user_id: currentUser.id,
                content: input.value.trim()
            }]);
            input.value = '';
            loadComments();
        }
    });
}

// Facebook-like post card with Like, Comment, Share, comment count, and triple dot menu
function createPostCard(post, user) {
    const card = document.createElement('div');
    card.className = 'post-card';

    // Header: avatar, name, time, triple dot menu
    const header = document.createElement('div');
    header.className = 'post-header';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.marginBottom = '0.5em';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '0.7em';

    const avatar = document.createElement('img');
    avatar.className = 'post-avatar';
    avatar.src = user?.avatar_url || 'assets/images/default-avatar.png';
    avatar.alt = 'User Avatar';
    avatar.style.width = '40px';
    avatar.style.height = '40px';
    avatar.style.borderRadius = '50%';
    avatar.onerror = function() { this.src = 'assets/images/default-avatar.png'; };

    const nameTime = document.createElement('div');
    nameTime.innerHTML = `<strong>${user?.nickname || user?.email || 'User'}</strong><br>
        <span style="font-size:0.9em;color:#888;">${timeAgo(post.created_at)}</span>`;

    left.appendChild(avatar);
    left.appendChild(nameTime);

    // Triple dot menu
    const menuWrapper = document.createElement('div');
    menuWrapper.style.position = 'relative';

    const menuBtn = document.createElement('button');
    menuBtn.innerHTML = '<i class="fas fa-ellipsis-h"></i>';
    menuBtn.style.background = 'none';
    menuBtn.style.border = 'none';
    menuBtn.style.cursor = 'pointer';
    menuBtn.style.fontSize = '1.2em';

    const menu = document.createElement('div');
    menu.className = 'post-menu';
    menu.style.display = 'none';
    menu.style.position = 'absolute';
    menu.style.right = '0';
    menu.style.top = '28px';
    menu.style.background = '#fff';
    menu.style.boxShadow = '0 2px 8px #eee';
    menu.style.borderRadius = '8px';
    menu.style.padding = '0.5em 0';
    menu.style.zIndex = '100';
    menu.style.minWidth = '120px';

    // Get current user
    let currentUserId = null;
    supabase.auth.getUser().then(({ data: { user: currentUser } }) => {
        currentUserId = currentUser?.id;

        // Only show Edit/Delete for post creator
        if (currentUserId && currentUserId === post.user_id) {
            // EDIT (modal version)
            const edit = document.createElement('div');
            edit.textContent = 'Edit';
            edit.style.padding = '0.5em 1em';
            edit.style.cursor = 'pointer';
            edit.addEventListener('click', async () => {
                menu.style.display = 'none';
                if (!editPostModal || !editPostContent || !saveEditButton) return;
                editPostModal.style.display = 'block';
                editPostContent.value = post.content;
                currentEditingPostId = post.id;

                // Remove previous listeners to avoid stacking
                const newSaveHandler = async () => {
                    const newContent = editPostContent.value.trim();
                    if (newContent && newContent !== post.content) {
                        const { error } = await supabase
                            .from('posts')
                            .update({ content: newContent })
                            .eq('id', post.id);
                        if (error) {
                            alert('Failed to update post: ' + error.message);
                        } else {
                            editPostModal.style.display = 'none';
                            fetchAndDisplayPosts();
                        }
                    } else {
                        editPostModal.style.display = 'none';
                    }
                    saveEditButton.removeEventListener('click', newSaveHandler);
                };
                saveEditButton.onclick = null;
                saveEditButton.addEventListener('click', newSaveHandler);

                // Close modal on outside click
                editPostModal.onclick = function(e) {
                    if (e.target === editPostModal) {
                        editPostModal.style.display = 'none';
                        saveEditButton.removeEventListener('click', newSaveHandler);
                    }
                };
            });
            menu.appendChild(edit);

            // DELETE
            const del = document.createElement('div');
            del.textContent = 'Delete';
            del.style.padding = '0.5em 1em';
            del.style.cursor = 'pointer';
            del.style.color = '#e74c3c';
            del.addEventListener('click', async () => {
                menu.style.display = 'none';
                if (confirm('Are you sure you want to delete this post?')) {
                    await supabase.from('posts').delete().eq('id', post.id);
                    fetchAndDisplayPosts(); // Refresh after delete
                }
            });
            menu.appendChild(del);
        }

        // Save (for all users)
        const save = document.createElement('div');
        save.textContent = 'Save';
        save.style.padding = '0.5em 1em';
        save.style.cursor = 'pointer';
        save.addEventListener('click', () => {
            menu.style.display = 'none';
            alert('Save post feature coming soon!');
        });
        menu.appendChild(save);

        // Cancel/Hide (for all users)
        const hide = document.createElement('div');
        hide.innerHTML = '<i class="fas fa-ban" style="margin-right:6px"></i>Don\'t show again';
        hide.style.padding = '0.5em 1em';
        hide.style.cursor = 'pointer';
        hide.addEventListener('click', () => {
            menu.style.display = 'none';
            card.style.display = 'none';
        });
        menu.appendChild(hide);
    });

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    });

    document.addEventListener('click', () => {
        menu.style.display = 'none';
    });

    menuWrapper.appendChild(menuBtn);
    menuWrapper.appendChild(menu);

    header.appendChild(left);
    header.appendChild(menuWrapper);
    card.appendChild(header);

    // Content
    if (post.content) {
        const content = document.createElement('div');
        content.className = 'post-content';
        content.textContent = post.content;
        content.style.marginBottom = '0.5em';
        card.appendChild(content);
    }

    // Media grid for multiple images/videos
    if (post.media_urls) {
        let urls = [];
        try { urls = JSON.parse(post.media_urls); } catch {}
        if (urls.length > 0) {
            const mediaGrid = document.createElement('div');
            mediaGrid.className = 'media-grid';
            mediaGrid.style.display = 'grid';
            mediaGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(120px, 1fr))';
            mediaGrid.style.gap = '8px';
            mediaGrid.style.marginBottom = '0.5em';
            urls.forEach(url => {
                if (/\.(mp4|webm|ogg)$/i.test(url)) {
                    const video = document.createElement('video');
                    video.src = url;
                    video.className = 'post-video';
                    video.controls = true;
                    video.style.width = '100%';
                    video.style.borderRadius = '10px';
                    mediaGrid.appendChild(video);
                } else {
                    const img = document.createElement('img');
                    img.src = url;
                    img.alt = 'Post Media';
                    img.className = 'post-image';
                    img.style.width = '100%';
                    img.style.borderRadius = '10px';
                    mediaGrid.appendChild(img);
                }
            });
            card.appendChild(mediaGrid);
        }
    } else if (post.image_url) {
        // Fallback for old posts with single image/video
        if (/\.(mp4|webm|ogg)$/i.test(post.image_url)) {
            const video = document.createElement('video');
            video.src = post.image_url;
            video.className = 'post-video';
            video.controls = true;
            video.style.maxWidth = '100%';
            video.style.borderRadius = '10px';
            video.style.marginBottom = '0.5em';
            card.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.src = post.image_url;
            img.alt = 'Post Image';
            img.className = 'post-image';
            img.style.maxWidth = '100%';
            img.style.borderRadius = '10px';
            img.style.marginBottom = '0.5em';
            card.appendChild(img);
        }
    }

    // Actions
    const actions = document.createElement('div');
    actions.className = 'post-actions';
    actions.style.display = 'flex';
    actions.style.gap = '2em';
    actions.style.marginTop = '0.5em';

    // Like button
    const likeBtn = document.createElement('span');
    likeBtn.style.cursor = 'pointer';
    likeBtn.innerHTML = `<i class="far fa-thumbs-up"></i> Like <span class="like-count">0</span>`;
    let liked = false;

    async function updateLikeDisplay() {
        try {
            const { data: { user: currentUser } } = await supabase.auth.getUser();
            let likeCount = 0;
            liked = false;
            if (currentUser) {
                const { data: likeData } = await supabase
                    .from('likes')
                    .select('id')
                    .eq('post_id', post.id)
                    .eq('user_id', currentUser.id)
                    .maybeSingle();
                liked = !!likeData;
            }
            const { count } = await supabase
                .from('likes')
                .select('*', { count: 'exact', head: true })
                .eq('post_id', post.id);
            likeCount = count || 0;
            likeBtn.innerHTML = liked
                ? `<i class="fas fa-thumbs-up"></i> Like <span class="like-count">${likeCount}</span>`
                : `<i class="far fa-thumbs-up"></i> Like <span class="like-count">${likeCount}</span>`;
            likeBtn.style.color = liked ? '#1877f2' : '';
        } catch (error) {
            console.error('Error updating like display:', error);
        }
    }

    likeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) return alert('Login to like');
        try {
            if (!liked) {
                const { error } = await supabase.from('likes').insert([{ post_id: post.id, user_id: currentUser.id }]);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', currentUser.id);
                if (error) throw error;
            }
            await updateLikeDisplay();
        } catch (error) {
            alert('Failed to update like. Please try again.');
            console.error(error);
        }
    });

    actions.appendChild(likeBtn);

    // Comment button with count
    const commentBtn = document.createElement('span');
    commentBtn.style.cursor = 'pointer';
    commentBtn.innerHTML = `<i class="far fa-comment"></i> Comment <span class="comment-count">0</span>`;
    commentBtn.addEventListener('click', () => {
        showCommentBox(card, post);
    });

    // Share
    const shareBtn = document.createElement('span');
    shareBtn.style.cursor = 'pointer';
    shareBtn.innerHTML = `<i class="far fa-share-square"></i> Share <span class="share-count">0</span>`;
    shareBtn.addEventListener('click', async () => {
        navigator.clipboard.writeText(window.location.href + `#post-${post.id}`);
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) await supabase.from('shares').insert([{ post_id: post.id, user_id: currentUser.id }]);
        alert('Post link copied!');
        updateCounts();
    });

    actions.appendChild(commentBtn);
    actions.appendChild(shareBtn);
    card.appendChild(actions);

    // Fetch and update counts
    async function updateCounts() {
        const { likeCount, shareCount, comments } = await fetchCounts(post.id);
        const likeCountSpan = likeBtn.querySelector('.like-count');
        if (likeCountSpan) likeCountSpan.textContent = likeCount;
        const shareCountSpan = shareBtn.querySelector('.share-count');
        if (shareCountSpan) shareCountSpan.textContent = shareCount;
        const commentCountSpan = commentBtn.querySelector('.comment-count');
        if (commentCountSpan) commentCountSpan.textContent = comments.length;
    }
    card.updateCounts = updateCounts;
    updateLikeDisplay();
    updateCounts();

    card.style.background = '#fff';
    card.style.borderRadius = '12px';
    card.style.boxShadow = '0 2px 8px #eee';
    card.style.padding = '1em';
    card.style.marginBottom = '1.2em';

    return card;
}

// Fetch and display all posts with user info
async function fetchAndDisplayPosts() {
    const postsGrid = document.querySelector('.posts-feed');
    if (!postsGrid) return;
    postsGrid.innerHTML = '';
    const { data: posts, error } = await supabase
        .from('posts')
        .select('*, user:user_id(nickname, avatar_url, email)')
        .order('created_at', { ascending: false });
    if (error) {
        console.error('Error fetching posts:', error.message);
        return;
    }
    if (!posts || posts.length === 0) {
        postsGrid.innerHTML = '<div style="color:#888;text-align:center;padding:2em;">No posts yet.</div>';
        return;
    }
    posts.forEach(post => {
        postsGrid.appendChild(createPostCard(post, post.user));
    });
    enablePostMediaFullScreen();
}

document.addEventListener('DOMContentLoaded', async () => {
    // --- Nickname Display ---
    const userProfileNicknameElement = document.querySelector('.user-profile .user-nickname');
    let currentUser = null;
    let currentUserNickname = 'Guest';

    if (userProfileNicknameElement) {
        try {
            const { data: { user }, error } = await supabase.auth.getUser();
            if (error) {
                userProfileNicknameElement.textContent = 'Guest';
            } else if (user) {
                currentUser = user;
                currentUserNickname = user.user_metadata?.nickname || user.email || 'User';
                userProfileNicknameElement.textContent = currentUserNickname;
            } else {
                userProfileNicknameElement.textContent = 'Guest';
            }
        } catch (error) {
            userProfileNicknameElement.textContent = 'Error';
        }
    }

    fetchAndDisplayStories();
    fetchAndDisplayPosts();

    // --- Add Story Functionality ---
    const addStoryCard = document.querySelector('.story-card.add-story');
    if (addStoryCard) {
        addStoryCard.style.cursor = 'pointer';
        addStoryCard.addEventListener('click', async () => {
            if (!currentUser) {
                alert('You must be logged in to add a story.');
                return;
            }
            // Ensure user exists in users table (fixes foreign key error)
            const { error: upsertError } = await supabase.from('users').upsert([
              {
                id: currentUser.id,
                nickname: currentUser.user_metadata?.nickname || currentUser.email,
                email: currentUser.email,
                avatar_url: currentUser.user_metadata?.avatar_url || null
              }
            ]);
            if (upsertError) {
              alert('Failed to sync user profile: ' + upsertError.message);
              return;
            }
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*,video/*';
            fileInput.style.display = 'none';

            fileInput.addEventListener('change', async (event) => {
                const file = event.target.files[0];
                if (file) {
                    const bucketName = 'story-uploads';
                    const filePath = `public/stories/${currentUser.id}/${Date.now()}_${file.name}`;
                    try {
                        const originalAddStoryContent = addStoryCard.innerHTML;
                        addStoryCard.innerHTML = 'Uploading...';
                        addStoryCard.style.pointerEvents = 'none';

                        const { error: uploadError } = await supabase.storage
                            .from(bucketName)
                            .upload(filePath, file, {
                                cacheControl: '3600',
                                upsert: false
                            });

                        if (uploadError) {
                            alert('Failed to upload story file: ' + uploadError.message);
                            addStoryCard.innerHTML = originalAddStoryContent;
                            addStoryCard.style.pointerEvents = 'auto';
                            return;
                        }

                        const { data: publicUrlData } = supabase.storage
                            .from(bucketName)
                            .getPublicUrl(filePath);

                        const publicUrl = publicUrlData.publicUrl;
                        const mediaType = file.type.startsWith('image/') ? 'image' : 'video';

                        const { data: storyDataArray, error: storyError } = await supabase
                            .from('stories')
                            .insert([
                                {
                                    user_id: currentUser.id,
                                    storage_path: filePath,
                                    media_url: publicUrl,
                                    media_type: mediaType
                                }
                            ])
                            .select('*, user:user_id(nickname, avatar_url)');

                        if (storyError) {
                            alert('Failed to save story details: ' + storyError.message);
                            addStoryCard.innerHTML = originalAddStoryContent;
                            addStoryCard.style.pointerEvents = 'auto';
                            return;
                        }

                        if (storyDataArray && storyDataArray.length > 0) {
                            const newStory = storyDataArray[0];
                            const nickname = newStory.user?.nickname || newStory.user?.email || 'User';
                            const avatarUrl = newStory.user?.avatar_url || 'assets/images/default-avatar.png';
                            const newStoryCardElement = createStoryCardElement(newStory, nickname, avatarUrl);
                            const storiesGrid = document.querySelector('.stories-grid');
                            if (storiesGrid) {
                                storiesGrid.insertBefore(newStoryCardElement, addStoryCard.nextSibling);
                                allDisplayedStories.unshift(newStory);
                            }
                        }

                        addStoryCard.innerHTML = originalAddStoryContent;
                        addStoryCard.style.pointerEvents = 'auto';

                    } catch (error) {
                        alert('An unexpected error occurred. Please try again.');
                        addStoryCard.innerHTML = originalAddStoryContent;
                        addStoryCard.style.pointerEvents = 'auto';
                    }
                }
            });

            document.body.appendChild(fileInput);
            fileInput.click();
            setTimeout(() => {
                document.body.removeChild(fileInput);
            }, 1000);
        });
    }

    if (storyCloseButton) {
        storyCloseButton.addEventListener('click', closeFullScreenStoryView);
    }
    if (storyPrevButton) {
        storyPrevButton.addEventListener('click', prevStory);
    }
    if (storyNextButton) {
        storyNextButton.addEventListener('click', nextStory);
    }

    if (storyModalOverlay && storyModalContent) {
        storyModalOverlay.addEventListener('click', (event) => {
            if (!storyModalContent.contains(event.target) && event.target === storyModalOverlay) {
                closeFullScreenStoryView();
            }
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && storyModalOverlay.classList.contains('visible')) {
            closeFullScreenStoryView();
        }
        if (event.key === 'Escape' && storyViewsModal && storyViewsModal.style.display === 'block') {
            storyViewsModal.style.display = 'none';
        }
    });

    document.querySelectorAll('img').forEach(img => {
        img.onerror = function() { setDefaultImage(this); };
    });

    // --- Photo/Video button triggers file input ---
    const photoBtn = document.getElementById('photoVideoBtn');
    const postImage = document.getElementById('postImage');
    const postImagePreview = document.getElementById('postImagePreview');
    if (photoBtn && postImage) {
        photoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            postImage.click();
        });
    }
    if (postImage && postImagePreview) {
        postImage.addEventListener('change', (e) => {
            postImagePreview.innerHTML = '';
            const files = Array.from(e.target.files);
            files.forEach(file => {
                let elem;
                if (file.type.startsWith('image/')) {
                    elem = document.createElement('img');
                    elem.src = URL.createObjectURL(file);
                    elem.style.maxWidth = '100px';
                    elem.style.maxHeight = '100px';
                    elem.style.borderRadius = '8px';
                    elem.style.margin = '5px';
                } else if (file.type.startsWith('video/')) {
                    elem = document.createElement('video');
                    elem.src = URL.createObjectURL(file);
                    elem.controls = true;
                    elem.style.maxWidth = '100px';
                    elem.style.maxHeight = '100px';
                    elem.style.borderRadius = '8px';
                    elem.style.margin = '5px';
                }
                postImagePreview.appendChild(elem);
            });
            postImagePreview.style.display = 'flex';
            postImagePreview.style.flexWrap = 'wrap';
            postImagePreview.style.gap = '8px';
        });
    }

    // --- Feeling/Activity dropdown ---
    let feelingDropdown = document.getElementById('feelingDropdown');
    const feelingBtn = document.getElementById('feelingBtn');
    const postContent = document.getElementById('postContent');
    if (feelingBtn && feelingDropdown && postContent) {
        feelingBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Position dropdown below the button
            const rect = feelingBtn.getBoundingClientRect();
            feelingDropdown.style.left = rect.left + 'px';
            feelingDropdown.style.top = (rect.bottom + window.scrollY) + 'px';
            feelingDropdown.style.display = 'block';
        });

        // Hide dropdown if click outside
        document.addEventListener('mousedown', (event) => {
            if (!feelingDropdown.contains(event.target) && event.target !== feelingBtn) {
                feelingDropdown.style.display = 'none';
            }
        });

        // Handle feeling select
        feelingDropdown.querySelectorAll('.feeling-option').forEach(option => {
            option.addEventListener('click', () => {
                postContent.value += (postContent.value ? ' ' : '') + option.dataset.feeling;
                feelingDropdown.style.display = 'none';
            });
        });
    }

    const createPostForm = document.getElementById('createPostForm');
    if (createPostForm) {
        createPostForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const content = document.getElementById('postContent').value.trim();
            const fileInput = document.getElementById('postImage');
            const files = Array.from(fileInput.files);

            let media_urls = [];
            if (files.length > 0) {
                for (const file of files) {
                    const filePath = `posts/${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name}`;
                    const { error: uploadError } = await supabase.storage
                        .from('posts')
                        .upload(filePath, file, { cacheControl: '3600', upsert: false });
                    if (uploadError) {
                        alert('Media upload failed: ' + uploadError.message);
                        return;
                    }
                    const { data: publicUrlData } = supabase.storage
                        .from('posts')
                        .getPublicUrl(filePath);
                    media_urls.push(publicUrlData.publicUrl);
                }
            }

            if (!content && media_urls.length === 0) {
                alert('Please enter some text or select media.');
                return;
            }

            // Get current user
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                alert('You must be logged in to post.');
                return;
            }

            // Ensure user exists in users table
            await supabase.from('users').upsert([
                {
                    id: user.id,
                    nickname: user.user_metadata?.nickname || user.email,
                    email: user.email,
                    avatar_url: user.user_metadata?.avatar_url || null
                }
            ]);

            // Insert post into Supabase
            const { error: insertError } = await supabase
                .from('posts')
                .insert([{
                    user_id: user.id,
                    content,
                    media_urls: JSON.stringify(media_urls)
                }]);
            if (insertError) {
                alert('Failed to create post: ' + insertError.message);
                return;
            }

            // Reset form and preview
            createPostForm.reset();
            if (postImagePreview) postImagePreview.innerHTML = '';

            // Refresh posts
            fetchAndDisplayPosts();
        });
    }
});