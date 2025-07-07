const diceButton = document.getElementById('dice');
const diceEyesInput = document.getElementById('dice-eyes');
const lobbyContainer = document.getElementById('lobby-container'); // Assuming lobby-container is your main container

// Helper function to extract rotation from a 2D transform matrix
function getRotationDegrees(matrix) {
    if (matrix === 'none') return 0;
    const values = matrix.split('(')[1].split(')')[0].split(',');
    const a = values[0];
    const b = values[1];
    let angle = Math.round(Math.atan2(b, a) * (180/Math.PI));
    return (angle < 0) ? angle + 360 : angle;
}

diceButton.addEventListener('click', () => {
    const numberOfEyes = parseInt(diceEyesInput.value, 10) || 6;
    let finalResult = Math.floor(Math.random() * numberOfEyes) + 1;

    // --- Create a new dice element ---
    const newDice = document.createElement('div');
    newDice.classList.add('dice-animation-element'); // Use a more specific class name
    // Add basic styling using inline styles or prefer a CSS class
    newDice.style.position = 'fixed';
    newDice.style.width = '80px';
    newDice.style.height = '80px';
    newDice.style.backgroundColor = 'white';
    newDice.style.borderRadius = '10px';
    newDice.style.display = 'flex';
    newDice.style.justifyContent = 'center';
    newDice.style.alignItems = 'center';
    newDice.style.fontSize = '3em';
    newDice.style.fontWeight = 'bold';
    newDice.style.color = 'black';
    newDice.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
    newDice.style.zIndex = '1000';


    // --- Generate random values for animation ---
    const startLeft = Math.random() * 20;
    const bounce1Height = Math.random() * 20 + 30;
    const bounce2Height = Math.random() * 15 + 50;

    // --- Generate random values for final position ---
    const baseFinalLeft = 60 + Math.random() * 30;
    const baseFinalTop = 70 + Math.random() * 20;

    const finalOffsetX = (Math.random() - 0.5) * 20;
    const finalOffsetY = (Math.random() - 0.5) * 20;


    const keyframes = [
        { left: `${startLeft}%`, top: '20%', transform: 'translate(-50%, -50%) rotate(0deg)' },
        { left: `${startLeft + 20 + Math.random() * 10}%`, top: '80%', transform: 'translate(-50%, -50%) rotate(' + (180 + Math.random() * 60) + 'deg)' },
        { left: `${startLeft + 40 + Math.random() * 10}%`, top: `${bounce1Height}%`, transform: 'translate(-50%, -50%) rotate(' + (300 + Math.random() * 60) + 'deg)' },
        { left: `${startLeft + 60 + Math.random() * 10}%`, top: '80%', transform: 'translate(-50%, -50%) rotate(' + (480 + Math.random() * 60) + 'deg)' },
        { left: `${startLeft + 70 + Math.random() * 10}%`, top: `${bounce2Height}%`, transform: 'translate(-50%, -50%) rotate(' + (600 + Math.random() * 60) + 'deg)' },
        { left: `${startLeft + 80 + Math.random() * 10}%`, top: '80%', transform: 'translate(-50%, -50%) rotate(' + (780 + Math.random() * 60) + 'deg)' },
        { left: `${baseFinalLeft + finalOffsetX}%`, top: `${baseFinalTop + finalOffsetY}%`, transform: 'translate(-50%, -50%) rotate(' + (840 + Math.random() * 60) + 'deg)' }
    ];

    const timing = {
        duration: 4000,
        iterations: 1,
        easing: 'ease-in-out',
        fill: 'forwards'
    };

    // Append the new dice to the DOM and start animation
    lobbyContainer.appendChild(newDice);

    const diceAnimation = newDice.animate(keyframes, timing);

    // --- Update number during animation using setInterval ---
    const updateInterval = 100;
    let intervalId;

    intervalId = setInterval(() => {
        const currentRandomNumber = Math.floor(Math.random() * numberOfEyes) + 1;
        newDice.textContent = currentRandomNumber;
    }, updateInterval);

    // --- Chain a final rotation animation and handle click ---
    diceAnimation.onfinish = () => {
        // Clear the interval to stop updating the number
        clearInterval(intervalId);

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

        const finalRotationKeyframesShortest = [
             { transform: `translate(-50%, -50%) rotate(${currentRotation}deg)` },
             { transform: `translate(-50%, -50%) rotate(${currentRotation + angleDifference}deg)` }
        ];


        const finalRotationTiming = {
            duration: 500,
            iterations: 1,
            easing: 'ease-out',
            fill: 'forwards'
        };

        // Run the final rotation animation
        newDice.animate(finalRotationKeyframesShortest, finalRotationTiming);

        // Display the final result
        newDice.textContent = finalResult;

        // Add click event listener to the new dice
        newDice.addEventListener('click', () => {
            newDice.remove(); // Remove the dice element from the DOM when clicked
        });
    };
});
