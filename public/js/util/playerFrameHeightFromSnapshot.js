

function isStackedLayout() {
    return window.innerWidth < 768; // Tailwind's 'md' breakpoint
}

export function getPlayerFrameHeightFromSnapshot(snapshot, fixedButtons, columns) {
    const numPlayers = snapshot.size;
    if (numPlayers > 0) {
        const leftPanelHeight = document.getElementById('left-panel').offsetHeight;
        const screenHeight = window.innerHeight;
        const bottomControlsHeight = fixedButtons.offsetHeight;
        const pageLabelHeight = document.getElementById('page-label').offsetHeight;
        let availableHeight = screenHeight - bottomControlsHeight - pageLabelHeight - 100; // extra spacing buffer
        if (isStackedLayout()) {
            availableHeight = availableHeight - leftPanelHeight;
        }
        const gapPx = 16; // gap-4 in Tailwind is 1rem = 16px
        const totalGap = (numPlayers > 2 ? (Math.ceil(numPlayers / columns) - 1) * gapPx : 0);

        const playerFrameHeight = (availableHeight - totalGap) / Math.ceil(numPlayers / columns);
        return playerFrameHeight;
    } else {
        return 0;
    }
}