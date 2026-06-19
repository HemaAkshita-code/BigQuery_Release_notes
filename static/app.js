// Global variables
let allUpdates = [];      // Flattened list of individual updates
let selectedUpdates = [];  // List of selected update objects
let activeFilter = 'all';  // Current filter category
let searchQuery = '';      // Current search query

// DOM Elements
const refreshBtn = document.getElementById('refresh-btn');
const refreshIcon = document.getElementById('refresh-icon');
const statusText = document.getElementById('status-text');
const statusDisplay = document.getElementById('status-display');
const searchInput = document.getElementById('search-input');
const clearSearch = document.getElementById('clear-search');
const notesGrid = document.getElementById('notes-grid');
const loadingState = document.getElementById('loading-state');
const emptyState = document.getElementById('empty-state');
const errorState = document.getElementById('error-state');
const errorMessage = document.getElementById('error-message');
const retryBtn = document.getElementById('retry-btn');
const resetFiltersBtn = document.getElementById('reset-filters-btn');

// Selection Bar Elements
const selectionBar = document.getElementById('selection-bar');
const selectionCount = document.getElementById('selection-count');
const tweetSelectedBtn = document.getElementById('tweet-selected-btn');
const clearSelectionBtn = document.getElementById('clear-selection-btn');

// Modal Elements
const tweetModal = document.getElementById('tweet-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const tweetTextarea = document.getElementById('tweet-textarea');
const charCounter = document.getElementById('char-counter');
const progressCircle = document.getElementById('progress-circle');
const sendTweetBtn = document.getElementById('send-tweet-btn');
const trimTweetBtn = document.getElementById('trim-tweet-btn');
const tweetValidationMsg = document.getElementById('tweet-validation-msg');
const tweetPreviewContent = document.getElementById('tweet-preview-content');
const styleOptionBtns = document.querySelectorAll('.style-option-btn');

// Initialize Circular Progress
const radius = 14;
const circumference = 2 * Math.PI * radius;
if (progressCircle) {
    progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
    progressCircle.style.strokeDashoffset = circumference;
}

// ----------------------------------------------------
// Core Initialization & Feed Sync
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    fetchReleaseNotes(false);
    setupEventListeners();
});

// Setup Events
function setupEventListeners() {
    refreshBtn.addEventListener('click', () => fetchReleaseNotes(true));
    retryBtn.addEventListener('click', () => fetchReleaseNotes(true));
    resetFiltersBtn.addEventListener('click', resetFilters);
    
    // Search inputs
    searchInput.addEventListener('input', handleSearchInput);
    clearSearch.addEventListener('click', () => {
        searchInput.value = '';
        clearSearch.style.display = 'none';
        searchQuery = '';
        filterAndRender();
    });
    
    // Filter Pill Selection
    const filterPills = document.querySelectorAll('.filter-pill');
    filterPills.forEach(pill => {
        pill.addEventListener('click', (e) => {
            // Find parent if clicked on count badge
            const targetPill = e.target.closest('.filter-pill');
            if (!targetPill) return;
            
            filterPills.forEach(p => {
                p.classList.remove('active');
                p.setAttribute('aria-checked', 'false');
            });
            targetPill.classList.add('active');
            targetPill.setAttribute('aria-checked', 'true');
            
            activeFilter = targetPill.dataset.type;
            filterAndRender();
        });
    });

    // Selection buttons
    clearSelectionBtn.addEventListener('click', clearAllSelections);
    tweetSelectedBtn.addEventListener('click', openTweetComposer);
    
    // Modal buttons
    closeModalBtn.addEventListener('click', closeTweetModal);
    tweetModal.addEventListener('click', (e) => {
        if (e.target === tweetModal) closeTweetModal();
    });
    
    tweetTextarea.addEventListener('input', updateTweetDetails);
    
    // Tweet style switches
    styleOptionBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            styleOptionBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            regenerateDraftText(e.target.dataset.style);
        });
    });
    
    trimTweetBtn.addEventListener('click', trimTweetToLimit);
    sendTweetBtn.addEventListener('click', launchTwitterIntent);
}

// Fetch Feed from Python Flask endpoint
function fetchReleaseNotes(forceRefresh = false) {
    showLoading();
    const url = `/api/release-notes${forceRefresh ? '?refresh=true' : ''}`;
    
    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error(`Server returned code ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.success) {
                processFeedData(data.notes);
                updateStatus(data.last_updated, data.fetched_fresh);
                if (forceRefresh) {
                    showToast('Feed successfully synchronized!', 'success');
                }
            } else {
                throw new Error(data.error || 'Failed to parse feed data');
            }
        })
        .catch(err => {
            console.error(err);
            showError(err.message);
            showToast('Sync failure. Check connection.', 'error');
        });
}

// Process the raw HTML content of entries and flatten them into individual updates
function processFeedData(rawNotes) {
    allUpdates = [];
    selectedUpdates = [];
    
    rawNotes.forEach((note, noteIndex) => {
        const doc = new DOMParser().parseFromString(note.content, 'text/html');
        let currentType = null;
        let currentContentElements = [];
        
        function flushUpdate() {
            if (currentType && currentContentElements.length > 0) {
                const tempDiv = document.createElement('div');
                currentContentElements.forEach(el => tempDiv.appendChild(el.cloneNode(true)));
                
                const cleanText = tempDiv.innerText.replace(/\s+/g, ' ').trim();
                const cleanType = currentType.toLowerCase().replace(/[^a-z]/g, '');
                
                allUpdates.push({
                    id: `update-${noteIndex}-${allUpdates.length}`,
                    date: note.title,
                    type: currentType, // e.g., "Feature", "Announcement"
                    typeCategory: getNormalizedType(cleanType),
                    html: tempDiv.innerHTML,
                    text: cleanText,
                    link: note.link
                });
                
                currentContentElements = [];
            }
        }
        
        Array.from(doc.body.children).forEach(el => {
            if (el.tagName === 'H3') {
                flushUpdate();
                currentType = el.innerText.trim();
            } else {
                if (currentType) {
                    currentContentElements.push(el);
                }
            }
        });
        
        flushUpdate();
        
        // Fallback in case of no H3 tags
        if (currentContentElements.length === 0 && allUpdates.filter(u => u.id.startsWith(`update-${noteIndex}-`)).length === 0 && note.content.trim() !== '') {
            const cleanText = doc.body.innerText.replace(/\s+/g, ' ').trim();
            allUpdates.push({
                id: `update-${noteIndex}-fallback`,
                date: note.title,
                type: 'Update',
                typeCategory: 'change',
                html: note.content,
                text: cleanText,
                link: note.link
            });
        }
    });

    calculateCategoryCounts();
    filterAndRender();
    updateSelectionBar();
}

// Normalize entry types for category pills
function getNormalizedType(typeStr) {
    if (typeStr.includes('feature')) return 'feature';
    if (typeStr.includes('announcement')) return 'announcement';
    if (typeStr.includes('breaking')) return 'breaking';
    if (typeStr.includes('issue') || typeStr.includes('bug')) return 'issue';
    return 'change';
}

// Calculate total counts for filter pill badges
function calculateCategoryCounts() {
    const counts = {
        all: allUpdates.length,
        feature: 0,
        announcement: 0,
        breaking: 0,
        issue: 0,
        change: 0
    };
    
    allUpdates.forEach(update => {
        if (counts[update.typeCategory] !== undefined) {
            counts[update.typeCategory]++;
        }
    });
    
    // Update badge values in HTML
    document.getElementById('count-all').innerText = counts.all;
    document.getElementById('count-feature').innerText = counts.feature;
    document.getElementById('count-announcement').innerText = counts.announcement;
    document.getElementById('count-breaking').innerText = counts.breaking;
    document.getElementById('count-issue').innerText = counts.issue;
    document.getElementById('count-change').innerText = counts.change;
}

// ----------------------------------------------------
// Filtering & Rendering Loop
// ----------------------------------------------------
function filterAndRender() {
    let filtered = allUpdates;
    
    // 1. Category Filter
    if (activeFilter !== 'all') {
        filtered = filtered.filter(u => u.typeCategory === activeFilter);
    }
    
    // 2. Search Query Filter
    if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(u => {
            return u.date.toLowerCase().includes(query) || 
                   u.type.toLowerCase().includes(query) || 
                   u.text.toLowerCase().includes(query);
        });
    }
    
    renderCards(filtered);
}

function renderCards(updates) {
    notesGrid.innerHTML = '';
    
    if (updates.length === 0) {
        showEmpty();
        return;
    }
    
    showGrid();
    
    updates.forEach(update => {
        const isChecked = selectedUpdates.some(su => su.id === update.id);
        const card = document.createElement('article');
        card.className = 'update-card';
        card.setAttribute('data-id', update.id);
        card.setAttribute('data-type', update.typeCategory);
        
        card.innerHTML = `
            <div class="card-header">
                <div class="card-date">
                    <i class="fa-regular fa-calendar-days"></i>
                    <span>${update.date}</span>
                </div>
                <span class="type-badge type-${update.typeCategory}">
                    ${getBadgeIcon(update.typeCategory)} ${update.type}
                </span>
            </div>
            <div class="card-body">
                ${update.html}
            </div>
            <div class="card-footer">
                <a href="${update.link}" target="_blank" rel="noopener noreferrer" class="card-link" title="Open official GCP documentation">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> Docs
                </a>
                <div class="card-actions">
                    <button class="btn-card-tweet single-tweet-btn" title="Tweet this update" aria-label="Tweet this update">
                        <i class="fa-brands fa-x-twitter"></i>
                    </button>
                    <label class="select-checkbox-container" title="Select to compile into a multi-tweet">
                        <input type="checkbox" class="update-select-chk" ${isChecked ? 'checked' : ''}>
                        <span class="checkbox-custom"></span>
                    </label>
                </div>
            </div>
        `;
        
        // Listeners for checkbox
        const chk = card.querySelector('.update-select-chk');
        chk.addEventListener('change', () => toggleSelection(update, chk.checked));
        
        // Quick Tweet button
        const tweetBtn = card.querySelector('.single-tweet-btn');
        tweetBtn.addEventListener('click', () => {
            selectedUpdates = [update];
            syncCardCheckboxes();
            updateSelectionBar();
            openTweetComposer();
        });
        
        notesGrid.appendChild(card);
    });
}

function getBadgeIcon(category) {
    switch (category) {
        case 'feature': return '<i class="fa-solid fa-circle-plus"></i>';
        case 'announcement': return '<i class="fa-solid fa-bullhorn"></i>';
        case 'breaking': return '<i class="fa-solid fa-triangle-exclamation"></i>';
        case 'issue': return '<i class="fa-solid fa-bug"></i>';
        default: return '<i class="fa-solid fa-wrench"></i>';
    }
}

// ----------------------------------------------------
// UI State Helpers
// ----------------------------------------------------
function showLoading() {
    loadingState.style.display = 'flex';
    notesGrid.style.display = 'none';
    emptyState.style.display = 'none';
    errorState.style.display = 'none';
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
    statusDisplay.className = 'status-badge loading';
    statusText.innerText = 'Syncing...';
}

function showGrid() {
    loadingState.style.display = 'none';
    notesGrid.style.display = 'grid';
    emptyState.style.display = 'none';
    errorState.style.display = 'none';
    refreshBtn.classList.remove('loading');
    refreshBtn.disabled = false;
}

function showEmpty() {
    loadingState.style.display = 'none';
    notesGrid.style.display = 'none';
    emptyState.style.display = 'flex';
    errorState.style.display = 'none';
    refreshBtn.classList.remove('loading');
    refreshBtn.disabled = false;
}

function showError(msg) {
    loadingState.style.display = 'none';
    notesGrid.style.display = 'none';
    emptyState.style.display = 'none';
    errorState.style.display = 'flex';
    errorMessage.innerText = msg;
    refreshBtn.classList.remove('loading');
    refreshBtn.disabled = false;
    statusDisplay.className = 'status-badge error';
    statusText.innerText = 'Sync Error';
}

function updateStatus(lastUpdatedTime, fromFresh) {
    statusDisplay.className = 'status-badge';
    statusText.innerText = `Last Checked: ${lastUpdatedTime.split(' ')[1]}`;
}

function handleSearchInput(e) {
    searchQuery = e.target.value;
    clearSearch.style.display = searchQuery ? 'block' : 'none';
    filterAndRender();
}

function resetFilters() {
    searchInput.value = '';
    clearSearch.style.display = 'none';
    searchQuery = '';
    
    const filterPills = document.querySelectorAll('.filter-pill');
    filterPills.forEach(p => {
        p.classList.remove('active');
        p.setAttribute('aria-checked', 'false');
    });
    filterPills[0].classList.add('active'); // Select "All"
    filterPills[0].setAttribute('aria-checked', 'true');
    
    activeFilter = 'all';
    filterAndRender();
}

// ----------------------------------------------------
// Multi-Selection Logic
// ----------------------------------------------------
function toggleSelection(update, isSelected) {
    if (isSelected) {
        if (!selectedUpdates.some(su => su.id === update.id)) {
            selectedUpdates.push(update);
        }
    } else {
        selectedUpdates = selectedUpdates.filter(su => su.id !== update.id);
    }
    updateSelectionBar();
}

function updateSelectionBar() {
    const count = selectedUpdates.length;
    if (count > 0) {
        selectionCount.innerText = `${count} ${count === 1 ? 'update' : 'updates'} selected`;
        selectionBar.style.display = 'flex';
    } else {
        selectionBar.style.display = 'none';
    }
}

function clearAllSelections() {
    selectedUpdates = [];
    syncCardCheckboxes();
    updateSelectionBar();
}

function syncCardCheckboxes() {
    const checkBoxes = document.querySelectorAll('.update-select-chk');
    checkBoxes.forEach(chk => {
        const card = chk.closest('.update-card');
        if (card) {
            const cardId = card.dataset.id;
            chk.checked = selectedUpdates.some(su => su.id === cardId);
        }
    });
}

// ----------------------------------------------------
// Tweet Composer Dialog & Social Post
// ----------------------------------------------------
function openTweetComposer() {
    if (selectedUpdates.length === 0) {
        showToast('Please select at least one update to Tweet.', 'info');
        return;
    }
    
    // Default draft style: balanced
    styleOptionBtns.forEach(btn => {
        if (btn.dataset.style === 'balanced') btn.classList.add('active');
        else btn.classList.remove('active');
    });
    
    regenerateDraftText('balanced');
    
    tweetModal.style.display = 'flex';
    tweetModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden'; // Lock background scroll
    tweetTextarea.focus();
}

function closeTweetModal() {
    tweetModal.style.display = 'none';
    tweetModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = 'auto'; // Unlock scroll
}

function generateDraftText(style, updates) {
    if (updates.length === 0) return '';
    
    if (updates.length === 1) {
        const u = updates[0];
        const link = u.link || 'https://docs.cloud.google.com/bigquery/docs/release-notes';
        switch (style) {
            case 'headline':
                return `BigQuery [${u.date}] - ${u.type}: ${u.text.substring(0, 100)}... #BigQuery`;
            case 'teaser':
                return `🚀 New BigQuery ${u.type} update on ${u.date}!\n\n${u.text.substring(0, 120)}...\n\nDetails: ${link} #GoogleCloud #Data`;
            case 'balanced':
            default:
                return `BigQuery Update [${u.date}] - ${u.type}:\n${u.text.substring(0, 140)}...\n\nDocs: ${link} #BigQuery #GCP`;
        }
    } else {
        // Multi-select summaries
        let header = `📢 Latest BigQuery updates:\n`;
        let body = '';
        updates.forEach(u => {
            const shortText = u.text.length > 50 ? u.text.substring(0, 50) + '...' : u.text;
            body += `• [${u.date}] ${u.type}: ${shortText}\n`;
        });
        
        switch (style) {
            case 'headline':
                return `BigQuery Summary:\n${updates.map(u => `- [${u.date}] ${u.type}`).join('\n')}\n#BigQuery #Data`;
            case 'teaser':
                return `🔥 BigQuery has ${updates.length} new updates!\n${updates.map(u => `👉 ${u.type} (${u.date})`).join('\n')}\nRead notes: https://docs.cloud.google.com/bigquery/docs/release-notes #GoogleCloud`;
            case 'balanced':
            default:
                const text = `${header}${body}\nRead docs: https://docs.cloud.google.com/bigquery/docs/release-notes #BigQuery`;
                return text;
        }
    }
}

function regenerateDraftText(style) {
    const draftText = generateDraftText(style, selectedUpdates);
    tweetTextarea.value = draftText;
    updateTweetDetails();
}

function updateTweetDetails() {
    const text = tweetTextarea.value;
    const len = text.length;
    const maxChars = 280;
    const remaining = maxChars - len;
    
    // Update numerical counter
    charCounter.innerText = remaining;
    
    // Update circular progress circle
    const progress = Math.min(len / maxChars, 1);
    const offset = circumference - (progress * circumference);
    
    if (progressCircle) {
        progressCircle.style.strokeDashoffset = offset;
        
        // Change colors depending on length
        if (remaining < 0) {
            progressCircle.style.stroke = '#ef4444'; // Red
            charCounter.style.color = '#ef4444';
            tweetValidationMsg.style.display = 'flex';
        } else if (remaining < 20) {
            progressCircle.style.stroke = '#f59e0b'; // Amber
            charCounter.style.color = '#f59e0b';
            tweetValidationMsg.style.display = 'none';
        } else {
            progressCircle.style.stroke = '#1da1f2'; // Twitter blue
            charCounter.style.color = '#9ca3af';
            tweetValidationMsg.style.display = 'none';
        }
    }
    
    // Update live preview markdown
    tweetPreviewContent.innerText = text;
}

function trimTweetToLimit() {
    const text = tweetTextarea.value;
    if (text.length <= 280) {
        showToast('Draft is already under 280 characters!', 'info');
        return;
    }
    
    // Smart trim logic: preserve tags and URLs if possible, truncate the middle text
    let trimmed = text;
    
    // Try to trim to 277 chars and add trailing '...'
    trimmed = text.substring(0, 277) + '...';
    
    tweetTextarea.value = trimmed;
    updateTweetDetails();
    showToast('Draft automatically truncated to fit character limit.', 'info');
}

function launchTwitterIntent() {
    const text = tweetTextarea.value;
    
    if (!text.trim()) {
        showToast('Tweet content cannot be empty.', 'error');
        return;
    }
    
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(intentUrl, '_blank', 'noopener,noreferrer');
    
    closeTweetModal();
    showToast('Redirected to Twitter (X) draft composer!', 'success');
}

// ----------------------------------------------------
// Toast Notification Engine
// ----------------------------------------------------
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-solid fa-circle-check';
    if (type === 'error') iconClass = 'fa-solid fa-circle-exclamation';
    else if (type === 'info') iconClass = 'fa-solid fa-circle-info';
    
    toast.innerHTML = `
        <i class="${iconClass}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Auto remove after 3.5 seconds
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
