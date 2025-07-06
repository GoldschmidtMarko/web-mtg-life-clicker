

const diceButton = document.getElementById('dice');
const diceDisplay = document.getElementById('dice-display');
const diceEyesInput = document.getElementById('dice-eyes');

// Add event listener to the dice display element
diceDisplay.addEventListener('click', () => {
    // Hide the dice display
    diceDisplay.style.display = 'none';
});

diceButton.addEventListener('click', () => {
    const numberOfEyes = parseInt(diceEyesInput.value, 10) || 6;
    let finalResult = Math.floor(Math.random() * numberOfEyes) + 1;

    // --- Generate random values for animation ---
    const startLeft = Math.random() * 20;
    const bounce1Height = Math.random() * 20 + 30;
    const bounce2Height = Math.random() * 15 + 50;
    // --- Generate random offset for final position ---
    const finalOffsetX = (Math.random() - 0.5) * 10; // Random value between -5 and 5
    const finalOffsetY = (Math.random() - 0.5) * 10; // Random value between -5 and 5

    const keyframes = [
        { left: `${startLeft}%`, top: '20%', transform: 'translate(-50%, -50%) rotate(0deg)' },
        { left: `${startLeft + 20 + Math.random() * 10}%`, top: '80%', transform: 'translate(-50%, -50%) rotate(' + (180 + Math.random() * 60) + 'deg)' },
        { left: `${startLeft + 40 + Math.random() * 10}%`, top: `${bounce1Height}%`, transform: 'translate(-50%, -50%) rotate(' + (300 + Math.random() * 60) + 'deg)' },
        { left: `${startLeft + 60 + Math.random() * 10}%`, top: '80%', transform: 'translate(-50%, -50%) rotate(' + (480 + Math.random() * 60) + 'deg)' },
        { left: `${startLeft + 70 + Math.random() * 10}%`, top: `${bounce2Height}%`, transform: 'translate(-50%, -50%) rotate(' + (600 + Math.random() * 60) + 'deg)' },
        { left: `${startLeft + 80 + Math.random() * 10}%`, top: '80%', transform: 'translate(-50%, -50%) rotate(' + (780 + Math.random() * 60) + 'deg)' },
        { left: `${80 + finalOffsetX}%`, top: `${80 + finalOffsetY}%`, transform: 'translate(-50%, -50%) rotate(' + (840 + Math.random() * 60) + 'deg)' } // Add random offset to final position
    ];

    const timing = {
        duration: 4000,
        iterations: 1,
        easing: 'ease-in-out',
        fill: 'forwards'
    };

    // Show the dice display
    diceDisplay.style.display = 'flex';
    // Clear previous inline styles if any
    diceDisplay.style.left = '';
    diceDisplay.style.top = '';
    // Ensure transform is also reset
    diceDisplay.style.transform = '';

    const diceAnimation = diceDisplay.animate(keyframes, timing);

    // --- Update number during animation using setInterval ---
    const updateInterval = 100;
    let intervalId;

    intervalId = setInterval(() => {
        const currentRandomNumber = Math.floor(Math.random() * numberOfEyes) + 1;
        diceDisplay.textContent = currentRandomNumber;
    }, updateInterval);

    // --- Chain a final rotation animation ---
    diceAnimation.onfinish = () => {
        // Clear the interval to stop updating the number
        clearInterval(intervalId);
    
        // Get the final position from the first animation's end state
        const computedStyle = getComputedStyle(diceDisplay);
        const finalLeft = computedStyle.left;
        const finalTop = computedStyle.top;
    
        // Set the final position as inline styles to hold it in place
        diceDisplay.style.left = finalLeft;
        diceDisplay.style.top = finalTop;
    
        // --- Calculate the current rotation angle ---
        // This is a bit more complex as getComputedStyle().transform returns a matrix.
        // A helper function is needed to extract the rotation in degrees from the matrix.
        // For now, let's assume we can get the approximate final angle from our keyframes.
        // A more robust solution would involve parsing the computed transform matrix.
        const approximateFinalAngle = 840; // Replace with a way to get the actual computed angle if needed

        // --- Define keyframes for the final rotation animation for shortest path ---
        // Calculate the angle difference
        let angleDifference = (0 - approximateFinalAngle) % 360;
        if (angleDifference > 180) {
            angleDifference -= 360;
        } else if (angleDifference < -180) {
            angleDifference += 360;
        }
    
        const finalRotationKeyframesShortest = [
             { transform: `translate(-50%, -50%) rotate(${approximateFinalAngle}deg)` }, // Start at the approximate final angle
             { transform: `translate(-50%, -50%) rotate(${approximateFinalAngle + angleDifference}deg)` } // End at 0 degrees rotation via shortest path
        ];
    
    
        const finalRotationTiming = {
            duration: 500,
            iterations: 1,
            easing: 'ease-out',
            fill: 'forwards'
        };
    
        // Run the final rotation animation using the shortest path keyframes
        diceDisplay.animate(finalRotationKeyframesShortest, finalRotationTiming);
    
        // Display the final result after the rotation animation starts
        diceDisplay.textContent = finalResult;
    
    };
});