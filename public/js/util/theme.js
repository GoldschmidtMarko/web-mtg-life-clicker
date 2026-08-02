const STORAGE_KEY = 'mtg-life-clicker-theme';

export function initThemeToggle(buttonId = 'theme-toggle') {
    const button = document.getElementById(buttonId);
    if (!button) return;

    button.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem(STORAGE_KEY, next);
    });
}
