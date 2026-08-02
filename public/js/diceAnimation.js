const lobbyContainer = document.getElementById('lobby-container');

// How long the dice stays on screen (fully settled) before it auto-dismisses.
const AUTO_HIDE_MS = 5000;

// Helper function to extract rotation from a 2D transform matrix
function getRotationDegrees(matrix) {
    if (matrix === 'none') return 0;
    const values = matrix.split('(')[1].split(')')[0].split(',');
    const a = values[0];
    const b = values[1];
    let angle = Math.round(Math.atan2(b, a) * (180 / Math.PI));
    return (angle < 0) ? angle + 360 : angle;
}

function removeDice(newDice) {
    if (!newDice.isConnected) return;
    newDice.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    newDice.style.opacity = '0';
    newDice.style.transform += ' scale(0.7)';
    setTimeout(() => newDice.remove(), 300);
}

// Plays the dice-roll animation for a result that has already been decided
// (server-authoritative, so every viewer in the lobby plays the exact same
// roll in sync). `finalResult` and `numberOfEyes` come from the lobby doc.
export function playDiceAnimation(finalResult, numberOfEyes) {
    // --- Create a new dice element ---
    const newDice = document.createElement('div');
    newDice.classList.add('dice-animation-element');
    newDice.style.position = 'fixed';
    newDice.style.width = '100px';
    newDice.style.height = '100px';
    newDice.style.background = 'linear-gradient(135deg, #ffffff 0%, #e5e7eb 100%)';
    newDice.style.borderRadius = '18px';
    newDice.style.display = 'flex';
    newDice.style.justifyContent = 'center';
    newDice.style.alignItems = 'center';
    newDice.style.fontSize = '3.4em';
    newDice.style.fontWeight = 'bold';
    newDice.style.color = 'black';
    newDice.style.boxShadow = '0 0 0 rgba(139, 92, 246, 0)';
    newDice.style.zIndex = '1000';

    // --- Generate random values for animation ---
    const startLeft = Math.random() * 20;
    const bounce1Height = Math.random() * 20 + 25;
    const bounce2Height = Math.random() * 15 + 40;
    const bounce3Height = Math.random() * 15 + 55;

    // --- Generate random values for final position ---
    const baseFinalLeft = 60 + Math.random() * 30;
    const baseFinalTop = 70 + Math.random() * 20;

    const finalOffsetX = (Math.random() - 0.5) * 20;
    const finalOffsetY = (Math.random() - 0.5) * 20;

    // More bounces and more total rotation than before for a bigger, more
    // dramatic flight before it settles.
    const keyframes = [
        { left: `${startLeft}%`, top: '10%', transform: 'translate(-50%, -50%) rotate(0deg) scale(0.6)' },
        { left: `${startLeft + 15 + Math.random() * 8}%`, top: '85%', transform: 'translate(-50%, -50%) rotate(' + (220 + Math.random() * 60) + 'deg) scale(1.1)' },
        { left: `${startLeft + 30 + Math.random() * 8}%`, top: `${bounce1Height}%`, transform: 'translate(-50%, -50%) rotate(' + (420 + Math.random() * 60) + 'deg) scale(1)' },
        { left: `${startLeft + 45 + Math.random() * 8}%`, top: '85%', transform: 'translate(-50%, -50%) rotate(' + (620 + Math.random() * 60) + 'deg) scale(1.05)' },
        { left: `${startLeft + 58 + Math.random() * 8}%`, top: `${bounce2Height}%`, transform: 'translate(-50%, -50%) rotate(' + (820 + Math.random() * 60) + 'deg) scale(1)' },
        { left: `${startLeft + 68 + Math.random() * 8}%`, top: '85%', transform: 'translate(-50%, -50%) rotate(' + (1000 + Math.random() * 60) + 'deg) scale(1.03)' },
        { left: `${startLeft + 76 + Math.random() * 8}%`, top: `${bounce3Height}%`, transform: 'translate(-50%, -50%) rotate(' + (1160 + Math.random() * 60) + 'deg) scale(1)' },
        { left: `${startLeft + 82 + Math.random() * 8}%`, top: '85%', transform: 'translate(-50%, -50%) rotate(' + (1300 + Math.random() * 60) + 'deg) scale(1.02)' },
        { left: `${baseFinalLeft + finalOffsetX}%`, top: `${baseFinalTop + finalOffsetY}%`, transform: 'translate(-50%, -50%) rotate(' + (1420 + Math.random() * 60) + 'deg) scale(1)' }
    ];

    const timing = {
        duration: 5200,
        iterations: 1,
        easing: 'cubic-bezier(0.33, 0, 0.2, 1)',
        fill: 'forwards'
    };

    // Append the new dice to the DOM and start animation
    lobbyContainer.appendChild(newDice);

    const diceAnimation = newDice.animate(keyframes, timing);

    // --- Update number during animation, slowing down toward the end for a
    // "spinning to a stop" feel instead of a constant-speed flicker. ---
    let cycleTimeoutId;
    const cycleStart = performance.now();
    const cycleDuration = timing.duration - 500; // stop cycling just before the landing snap

    function scheduleNextCycle() {
        const elapsed = performance.now() - cycleStart;
        if (elapsed >= cycleDuration) return;
        const progress = elapsed / cycleDuration;
        // Ease from a fast 60ms flicker up to a lazy 220ms flicker.
        const interval = 60 + progress * progress * 160;

        newDice.textContent = Math.floor(Math.random() * numberOfEyes) + 1;
        cycleTimeoutId = setTimeout(scheduleNextCycle, interval);
    }
    scheduleNextCycle();

    // --- Chain a final rotation animation and handle click/auto-dismiss ---
    diceAnimation.onfinish = () => {
        clearTimeout(cycleTimeoutId);

        // Get the final computed style
        const computedStyle = getComputedStyle(newDice);
        const finalLeft = computedStyle.left;
        const finalTop = computedStyle.top;
        const finalTransformMatrix = computedStyle.transform;

        // Set the final position as inline styles to hold it in place
        newDice.style.left = finalLeft;
        newDice.style.top = finalTop;
        newDice.style.transform = finalTransformMatrix;

        // --- Calculate the current rotation angle from the matrix ---
        const currentRotation = getRotationDegrees(finalTransformMatrix);

        // --- Define keyframes for the final rotation animation for shortest path ---
        let angleDifference = (0 - currentRotation) % 360;
        if (angleDifference > 180) {
            angleDifference -= 360;
        } else if (angleDifference < -180) {
            angleDifference += 360;
        }

        const landingKeyframes = [
            { transform: `translate(-50%, -50%) rotate(${currentRotation}deg) scale(1)`, boxShadow: '0 0 0 rgba(139, 92, 246, 0)' },
            { transform: `translate(-50%, -50%) rotate(${currentRotation + angleDifference}deg) scale(1.25)`, boxShadow: '0 0 30px rgba(139, 92, 246, 0.8)' },
            { transform: `translate(-50%, -50%) rotate(${currentRotation + angleDifference}deg) scale(1)`, boxShadow: '0 0 14px rgba(139, 92, 246, 0.5)' }
        ];

        const landingTiming = {
            duration: 550,
            iterations: 1,
            easing: 'ease-out',
            fill: 'forwards'
        };

        // Run the landing "pop" animation
        newDice.animate(landingKeyframes, landingTiming);

        // Display the final result
        newDice.textContent = finalResult;

        // Clicking dismisses immediately; otherwise it auto-dismisses after
        // AUTO_HIDE_MS so it doesn't linger on screen forever.
        newDice.style.cursor = 'pointer';
        newDice.addEventListener('click', () => removeDice(newDice));
        setTimeout(() => removeDice(newDice), AUTO_HIDE_MS);
    };
}
