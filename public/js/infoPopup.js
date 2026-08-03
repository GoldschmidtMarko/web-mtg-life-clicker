import { firebaseConfig } from './util/firebaseConfig.js';

// Initialize Firebase (only once per app)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const functions = firebase.app().functions('europe-west3');
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    functions.useEmulator('localhost', 5001);
}

const recordPayInterest = functions.httpsCallable('recordPayInterest');
const submitFeedback = functions.httpsCallable('submitFeedback');

// Function to show usage example popup
export function showUsageExamplePopup() {
    const backdrop = document.createElement('div');
    backdrop.className = 'fixed inset-0 flex items-center justify-center z-50';
    backdrop.style.cssText = `
        background-color: var(--scrim);
        opacity: 0;
        transition: opacity 0.3s ease-in-out;
    `;

    const popup = document.createElement('div');
    popup.className = 'panel';
    popup.style.cssText = `
        padding: 20px;
        max-width: 95%;
        max-height: 95vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        transform: scale(0.9);
        transition: transform 0.3s ease-in-out;
    `;

    const title = document.createElement('h2');
    title.textContent = 'Pro Tip: Display on a Big Screen';
    title.style.cssText = `
        font-size: 1.5rem;
        font-weight: bold;
        color: var(--ink);
        margin: 0 0 15px 0;
        text-align: center;
    `;

    const img = document.createElement('img');
    img.src = 'images/usage_example.webp';
    img.alt = 'Usage Example';
    img.style.cssText = `
        max-width: 100%;
        max-height: 70vh;
        width: auto;
        height: auto;
        object-fit: contain;
        border-radius: 8px;
        border: 1px solid var(--border);
    `;

    const closeButton = document.createElement('button');
    closeButton.className = 'btn btn-primary';
    closeButton.textContent = 'Got it!';
    closeButton.style.marginTop = '20px';

    popup.appendChild(title);
    popup.appendChild(img);
    popup.appendChild(closeButton);
    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);

    // Animation
    requestAnimationFrame(() => {
        backdrop.style.opacity = '1';
        popup.style.transform = 'scale(1)';
    });

    const close = async () => {
        backdrop.style.opacity = '0';
        popup.style.transform = 'scale(0.9)';
        setTimeout(() => {
            backdrop.remove();
        }, 300);
    };

    closeButton.addEventListener('click', close);
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close();
    });
}

// Function to show the feedback / recommendation popup
export function showFeedbackPopup() {
    const backdrop = document.createElement('div');
    backdrop.className = 'fixed inset-0 flex items-center justify-center z-50';
    backdrop.style.cssText = `
        background-color: var(--scrim);
        opacity: 0;
        transition: opacity 0.3s ease-in-out;
    `;

    const popup = document.createElement('div');
    popup.className = 'panel';
    popup.style.cssText = `
        padding: 20px;
        max-width: 95%;
        width: 420px;
        display: flex;
        flex-direction: column;
        transform: scale(0.9);
        transition: transform 0.3s ease-in-out;
    `;

    const title = document.createElement('h2');
    title.textContent = 'Send Feedback';
    title.style.cssText = `
        font-size: 1.5rem;
        font-weight: bold;
        color: var(--ink);
        margin: 0 0 10px 0;
        text-align: center;
    `;

    const description = document.createElement('p');
    description.textContent = 'Have a recommendation or found something that could be better? Let me know!';
    description.style.cssText = `
        font-size: 0.875rem;
        color: var(--ink-dim);
        margin: 0 0 14px 0;
        text-align: center;
    `;

    const textarea = document.createElement('textarea');
    textarea.className = 'field';
    textarea.rows = 5;
    textarea.maxLength = 2000;
    textarea.placeholder = 'Your recommendation or feedback...';
    textarea.style.resize = 'vertical';

    const statusMessage = document.createElement('p');
    statusMessage.style.cssText = `
        font-size: 0.8125rem;
        margin: 10px 0 0 0;
        text-align: center;
        min-height: 1.2em;
    `;

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 18px;';

    const cancelButton = document.createElement('button');
    cancelButton.className = 'btn btn-secondary';
    cancelButton.textContent = 'Cancel';

    const submitButton = document.createElement('button');
    submitButton.className = 'btn btn-primary';
    submitButton.textContent = 'Submit';

    buttonRow.appendChild(cancelButton);
    buttonRow.appendChild(submitButton);

    popup.appendChild(title);
    popup.appendChild(description);
    popup.appendChild(textarea);
    popup.appendChild(statusMessage);
    popup.appendChild(buttonRow);
    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);

    // Animation
    requestAnimationFrame(() => {
        backdrop.style.opacity = '1';
        popup.style.transform = 'scale(1)';
        textarea.focus();
    });

    const close = () => {
        backdrop.style.opacity = '0';
        popup.style.transform = 'scale(0.9)';
        setTimeout(() => {
            backdrop.remove();
        }, 300);
    };

    cancelButton.addEventListener('click', close);
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close();
    });

    submitButton.addEventListener('click', async () => {
        const message = textarea.value.trim();
        if (!message) {
            statusMessage.textContent = 'Please write something before submitting.';
            statusMessage.style.color = 'var(--danger)';
            return;
        }

        const originalText = submitButton.textContent;
        submitButton.disabled = true;
        cancelButton.disabled = true;
        submitButton.textContent = 'Sending...';
        statusMessage.textContent = '';

        try {
            await submitFeedback({ message });
            statusMessage.textContent = 'Thank you for your feedback!';
            statusMessage.style.color = 'var(--success)';
            textarea.value = '';
            setTimeout(close, 1500);
        } catch (error) {
            console.error('Error submitting feedback:', error);
            statusMessage.textContent = error.message || 'Failed to send feedback. Please try again.';
            statusMessage.style.color = 'var(--danger)';
            submitButton.disabled = false;
            cancelButton.disabled = false;
            submitButton.textContent = originalText;
        }
    });
}

class InfoPopup {
    constructor() {
        this.isOpen = false;
        this.popupElement = null;
    }

    addUsageExampleButton() {
        const usageExampleButton = document.createElement('button');
        usageExampleButton.id = 'usage-example-button';
        usageExampleButton.className = 'fab fixed bottom-4 left-36 z-40';
        usageExampleButton.innerHTML = '<i class="fas fa-lightbulb"></i>';
        usageExampleButton.onclick = showUsageExamplePopup;
        usageExampleButton.title = 'Usage Example';

        document.body.appendChild(usageExampleButton);
    }

    show(type = 'info') {
        if (this.isOpen) return;

        this.isOpen = true;
        this.createPopupElements(type);
        this.attachEventListeners();
        this.animateIn();
    }

    createPopupElements(type) {
        // Create backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'info-popup-backdrop';
        backdrop.className = 'fixed inset-0 flex items-center justify-center z-50';
        backdrop.style.backgroundColor = 'var(--scrim)';

        // Create popup container
        const container = document.createElement('div');
        container.className = 'panel p-4 sm:p-6 lg:p-8 max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg w-full mx-3 sm:mx-4 md:mx-6 transform transition-all duration-300 opacity-0 scale-90 max-h-screen overflow-y-auto';

        // Get content based on type
        const content = this.getContentByType(type);

        // Create content
        container.innerHTML = content;

        backdrop.appendChild(container);
        document.body.appendChild(backdrop);
        this.popupElement = backdrop;
    }

    getContentByType(type) {
        switch(type) {
            case 'info':
                return `
                    <div class="flex items-center justify-between mb-4 sm:mb-6">
                        <h2 class="text-lg sm:text-xl md:text-2xl font-bold" style="color: var(--ink);">About MTG Life Clicker</h2>
                        <button id="close-info-popup" class="icon-btn" aria-label="Close">&times;</button>
                    </div>
                    <div class="text-sm sm:text-base space-y-3 sm:space-y-4" style="color: var(--ink-dim);">
                        <p>Welcome to MTG Life Clicker, your digital companion for Magic: The Gathering games!</p>
                        <p>This application helps you track life totals and manage multiplayer sessions with ease. Create lobbies, invite friends, and keep track of everyone's life points in real-time.</p>
                        <p>Features include secure Google authentication and real-time synchronization.</p>
                        <p>Each player can independently adjust their life total, ensuring accurate tracking throughout your game.</p>
                        <p>Perfect for Commander, Standard, and any other MTG format where life tracking is essential.</p>
                        <p>You have problems, suggestions or want to contact me? Send me an email at:</p>
                        <p class="alert alert-info text-center mt-4">
                            <a href="mailto:mtglifeclicker@gmail.com" class="font-semibold text-base sm:text-lg underline" style="color: var(--ink);">
                                mtglifeclicker@gmail.com
                            </a>
                        </p>
                    </div>
                    <div class="mt-6 sm:mt-8 flex justify-end">
                        <button id="confirm-close-popup" class="btn btn-primary">Got it!</button>
                    </div>
                `;
            case 'help':
                return `
                    <div class="flex items-center justify-between mb-4 sm:mb-6">
                        <h2 class="text-lg sm:text-xl md:text-2xl font-bold" style="color: var(--ink);">Important Performance Notice</h2>
                        <button id="close-info-popup" class="icon-btn" aria-label="Close">&times;</button>
                    </div>
                    <div class="text-sm sm:text-base space-y-3 sm:space-y-4" style="color: var(--ink-dim);">
                        <div class="alert alert-warning">
                            <div class="flex">
                                <div class="flex-shrink-0">
                                    <i class="fas fa-exclamation-triangle"></i>
                                </div>
                                <div class="ml-3">
                                    <strong style="color: var(--ink);">Please be patient!</strong> Initial responses may be slow due to our free hosting plan and billing policies. Functions may take 10-30 seconds to "wake up" on <strong style="color: var(--ink);">first use</strong>.
                                </div>
                            </div>
                        </div>

                        <div class="alert alert-info">
                            <div class="flex">
                                <div class="flex-shrink-0">
                                    <i class="fas fa-question-circle"></i>
                                </div>
                                <div class="ml-3">
                                    <strong style="color: var(--ink);">Why the delays?</strong> This is a private project built and maintained by one person in their spare time. It runs on free-tier hosting to keep costs minimal while providing this service for free to the MTG community.
                                </div>
                            </div>
                        </div>

                        <p><strong style="color: var(--ink);">How You Can Help:</strong></p>
                        <div class="alert alert-success">
                            <p style="color: var(--ink);">Support this project to improve performance:</p>
                            <ul class="list-disc list-inside space-y-1 mt-2">
                                <li>Fast response time with premium hosting</li>
                                <li>More reliable server uptime</li>
                                <li>New features and improvements</li>
                                <li>Better user experience for everyone</li>
                            </ul>
                            <div class="mt-4 space-y-2">
                                <p style="color: var(--ink);" class="font-semibold">Choose how to help:</p>
                                <div class="flex flex-col space-y-2">
                                    <button id="show-interest-btn" class="btn btn-primary">
                                        I'm Interested in Supporting
                                    </button>
                                    <a href="mailto:mtglifeclicker@gmail.com?subject=Support%20MTG%20Life%20Clicker" class="btn btn-success no-underline">
                                        Contact Me Directly
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="mt-6 sm:mt-8 flex justify-end">
                        <button id="confirm-close-popup" class="btn btn-secondary">I Understand</button>
                    </div>
                `;
            default:
                return this.getContentByType('info');
        }
    }

    attachEventListeners() {
        const closeBtn = document.getElementById('close-info-popup');
        const confirmBtn = document.getElementById('confirm-close-popup');
        const backdrop = this.popupElement;

        closeBtn.addEventListener('click', () => this.hide());
        confirmBtn.addEventListener('click', () => this.hide());

        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) this.hide();
        });

        // Handle show interest button if it exists
        const showInterestBtn = document.getElementById('show-interest-btn');
        if (showInterestBtn) {
            showInterestBtn.addEventListener('click', () => this.handleShowInterest());
        }

        document.addEventListener('keydown', this.handleKeyPress.bind(this));
    }

    async handleShowInterest() {
        const btn = document.getElementById('show-interest-btn');
        const originalText = btn.innerHTML;

        try {
            // Disable button and show loading
            btn.disabled = true;
            btn.innerHTML = 'Recording interest...';

            // Check if user is authenticated
            const user = firebase.auth().currentUser;
            if (!user) {
                throw new Error('Please sign in first to show your interest.');
            }

            // Call the Cloud Function
            const result = await recordPayInterest();

            // Success feedback using result message
            btn.innerHTML = result.data.message || 'Thank you for your interest!';

            setTimeout(() => {
                this.hide();
            }, 2000);

        } catch (error) {
            console.error('Error recording interest:', error);

            let errorMessage = 'Error - Please try again';

            // Handle specific error cases
            if (error.code === 'functions/unauthenticated') {
                errorMessage = 'Please sign in first';
            } else if (error.code === 'functions/resource-exhausted') {
                errorMessage = error.message;
            } else if (error.message.includes('sign in')) {
                errorMessage = 'Please sign in first';
            }

            // Error feedback
            btn.classList.add('btn-danger');
            btn.innerHTML = errorMessage;

            setTimeout(() => {
                btn.disabled = false;
                btn.classList.remove('btn-danger');
                btn.innerHTML = originalText;
            }, 3000);
        }
    }

    handleKeyPress(e) {
        if (e.key === 'Escape' && this.isOpen) {
            this.hide();
        }
    }

    animateIn() {
        requestAnimationFrame(() => {
            const container = this.popupElement.querySelector('div');
            container.classList.remove('opacity-0', 'scale-90');
            container.classList.add('opacity-100', 'scale-100');
        });
    }

    hide() {
        if (!this.isOpen) return;

        const container = this.popupElement.querySelector('div');
        container.classList.remove('opacity-100', 'scale-100');
        container.classList.add('opacity-0', 'scale-90');

        setTimeout(() => {
            if (this.popupElement && this.popupElement.parentNode) {
                this.popupElement.parentNode.removeChild(this.popupElement);
            }
            this.popupElement = null;
            this.isOpen = false;
            document.removeEventListener('keydown', this.handleKeyPress.bind(this));
        }, 300);
    }
}

// Initialize and expose globally
window.infoPopup = new InfoPopup();
window.infoPopup.addUsageExampleButton();

// Function to open the info popup
function openInfoPopup() {
    window.infoPopup.show('info');
}

// Function to open the help popup
function openHelpPopup() {
    window.infoPopup.show('help');
}

// Auto-initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Create and add the info button to the page
    const infoButton = document.createElement('button');
    infoButton.id = 'info-button';
    infoButton.className = 'fab fixed bottom-4 left-4 z-40';
    infoButton.innerHTML = '<i class="fas fa-info"></i>';
    infoButton.onclick = openInfoPopup;
    infoButton.title = 'About';

    // Create and add the performance notice button to the page
    const helpButton = document.createElement('button');
    helpButton.id = 'help-button';
    helpButton.className = 'fab fixed bottom-4 left-20 z-40';
    helpButton.innerHTML = '<i class="fas fa-clock"></i>';
    helpButton.onclick = openHelpPopup;
    helpButton.title = 'Performance Notice';

    // Create and add the feedback button to the page
    const feedbackButton = document.createElement('button');
    feedbackButton.id = 'feedback-button';
    feedbackButton.className = 'fab fixed bottom-4 left-52 z-40';
    feedbackButton.innerHTML = '<i class="fas fa-comment"></i>';
    feedbackButton.onclick = showFeedbackPopup;
    feedbackButton.title = 'Feedback';

    document.body.appendChild(infoButton);
    document.body.appendChild(helpButton);
    document.body.appendChild(feedbackButton);
});
