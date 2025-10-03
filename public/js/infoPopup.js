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

class InfoPopup {
    constructor() {
        this.isOpen = false;
        this.popupElement = null;
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
        backdrop.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50';
        
        // Create popup container
        const container = document.createElement('div');
        container.className = 'bg-white rounded-xl p-8 max-w-lg w-full mx-4 shadow-2xl transform transition-all duration-300 opacity-0 scale-90';
        
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
                    <div class="flex items-center justify-between mb-6">
                        <h2 class="text-2xl font-bold text-gray-800">About MTG Life Clicker</h2>
                        <button id="close-info-popup" class="text-gray-500 hover:text-gray-700 text-3xl font-bold leading-none">&times;</button>
                    </div>
                    <div class="text-gray-600 space-y-4">
                        <p>Welcome to MTG Life Clicker, your digital companion for Magic: The Gathering games!</p>
                        <p>This application helps you track life totals and manage multiplayer sessions with ease. Create lobbies, invite friends, and keep track of everyone's life points in real-time.</p>
                        <p>Features include secure Google authentication and real-time synchronization.</p>
                        <p>Each player can independently adjust their life total, ensuring accurate tracking throughout your game.</p>
                        <p>Perfect for Commander, Standard, and any other MTG format where life tracking is essential.</p>
                        <p>You have problems, suggestions or want to contact me? Send me an email at:</p>
                        <p class="text-center bg-blue-50 border-2 border-blue-300 rounded-lg p-3 mt-4">
                            <a href="mailto:mtglifeclicker@gmail.com" class="text-blue-600 hover:text-blue-800 font-semibold text-lg underline decoration-2 hover:decoration-blue-800 transition-colors duration-200">
                                mtglifeclicker@gmail.com
                            </a>
                        </p>
                    </div>
                    <div class="mt-8 flex justify-end">
                        <button id="confirm-close-popup" class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium transition-colors duration-200">Got it!</button>
                    </div>
                `;
            case 'help':
                return `
                    <div class="flex items-center justify-between mb-6">
                        <h2 class="text-2xl font-bold text-gray-800">Important Performance Notice</h2>
                        <button id="close-info-popup" class="text-gray-500 hover:text-gray-700 text-3xl font-bold leading-none">&times;</button>
                    </div>
                    <div class="text-gray-600 space-y-4">
                        <div class="bg-amber-50 border-l-4 border-amber-400 p-4 rounded">
                            <div class="flex">
                                <div class="flex-shrink-0">
                                    <i class="fas fa-exclamation-triangle text-amber-400"></i>
                                </div>
                                <div class="ml-3">
                                    <p class="text-sm text-amber-700">
                                        <strong>Please be patient!</strong> Initial responses may be slow due to our free hosting plan and billing policies. Functions may take 10-30 seconds to "wake up" on <strong>first use</strong>.
                                    </p>
                                </div>
                            </div>
                        </div>
                        
                        <div class="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
                            <div class="flex">
                                <div class="flex-shrink-0">
                                    <i class="fas fa-question-circle text-blue-400"></i>
                                </div>
                                <div class="ml-3">
                                    <p class="text-sm text-blue-700">
                                        <strong>Why the delays?</strong> This is a private project built and maintained by one person in their spare time. It runs on free-tier hosting to keep costs minimal while providing this service for free to the MTG community.
                                    </p>
                                </div>
                            </div>
                        </div>
                        
                        <p><strong>How You Can Help:</strong></p>
                        <div class="bg-green-50 border-2 border-green-300 rounded-lg p-4">
                            <p class="text-green-800">Support this project to improve performance:</p>
                            <ul class="list-disc list-inside space-y-1 mt-2 text-green-700">
                                <li>Fast response time with premium hosting</li>
                                <li>More reliable server uptime</li>
                                <li>New features and improvements</li>
                                <li>Better user experience for everyone</li>
                            </ul>
                            <div class="mt-4 space-y-2">
                                <p class="text-green-800 font-semibold">Choose how to help:</p>
                                <div class="flex flex-col space-y-2">
                                    <button id="show-interest-btn" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-200">
                                        I'm Interested in Supporting
                                    </button>
                                    <a href="mailto:mtglifeclicker@gmail.com?subject=Support%20MTG%20Life%20Clicker" class="text-center bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-200 no-underline">
                                        Contact Me Directly
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="mt-8 flex justify-end">
                        <button id="confirm-close-popup" class="bg-amber-600 hover:bg-amber-700 text-white px-6 py-2 rounded-lg font-medium transition-colors duration-200">I Understand</button>
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
            btn.innerHTML = '⏳ Recording interest...';
            btn.className = btn.className.replace('bg-blue-600 hover:bg-blue-700', 'bg-gray-500');
            
            // Check if user is authenticated
            const user = firebase.auth().currentUser;
            if (!user) {
                throw new Error('Please sign in first to show your interest.');
            }
            
            // Call the Cloud Function
            const result = await recordPayInterest();
            
            // Success feedback using result message
            btn.innerHTML = '✅ ' + (result.data.message || 'Thank you for your interest!');
            btn.className = btn.className.replace('bg-gray-500', 'bg-green-600');
            
            setTimeout(() => {
                this.hide();
            }, 2000);
            
        } catch (error) {
            console.error('Error recording interest:', error);
            
            let errorMessage = '❌ Error - Please try again';
            
            // Handle specific error cases
            if (error.code === 'functions/unauthenticated') {
                errorMessage = '❌ Please sign in first';
            } else if (error.code === 'functions/resource-exhausted') {
                errorMessage = '❌ ' + error.message;
            } else if (error.message.includes('sign in')) {
                errorMessage = '❌ Please sign in first';
            }
            
            // Error feedback
            btn.innerHTML = errorMessage;
            btn.className = btn.className.replace('bg-gray-500', 'bg-red-600');
            
            setTimeout(() => {
                btn.disabled = false;
                btn.innerHTML = originalText;
                btn.className = btn.className.replace('bg-red-600', 'bg-blue-600 hover:bg-blue-700');
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
    infoButton.className = 'fixed bottom-4 left-4 bg-blue-600 hover:bg-blue-700 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-105 z-40';
    infoButton.innerHTML = '<i class="fas fa-info text-lg"></i>';
    infoButton.onclick = openInfoPopup;
    infoButton.title = 'About';
    
    // Create and add the performance notice button to the page
    const helpButton = document.createElement('button');
    helpButton.id = 'help-button';
    helpButton.className = 'fixed bottom-4 left-20 bg-amber-600 hover:bg-amber-700 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-105 z-40';
    helpButton.innerHTML = '<i class="fas fa-clock text-lg"></i>';
    helpButton.onclick = openHelpPopup;
    helpButton.title = 'Performance Notice';
    
    document.body.appendChild(infoButton);
    document.body.appendChild(helpButton);
});