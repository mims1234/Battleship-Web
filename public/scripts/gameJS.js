const GRID_SIZE = 10;
const SHIPS = [
    { name: "Carrier", size: 5 },
    { name: "Battleship", size: 4 },
    { name: "Cruiser", size: 3 },
    { name: "Submarine", size: 3 },
    { name: "Destroyer", size: 2 }
];
let playerGrid = [];
let aiGrid = [];
let playerShips = [];
let aiShips = [];
let currentShipIndex = 0;
let isPlacingShips = true;
let isPlayerTurn = true;
let gameOver = false;
let isHorizontal = true;
let aiLastHit = null;
let aiHuntMode = false;
let aiHuntQueue = [];
let playerSunkShips = 0;
let aiSunkShips = 0;
let playerScore = 0;
let aiScore = 0;

function initGrid(grid) {
    for (let i = 0; i < GRID_SIZE; i++) {
        grid[i] = new Array(GRID_SIZE).fill(0);
    }
}

function createGridDOM(gridId) {
    const gridElement = document.getElementById(gridId);
    gridElement.innerHTML = '';
    
    gridElement.appendChild(createCell('label', ''));
    for (let i = 0; i < GRID_SIZE; i++) {
        gridElement.appendChild(createCell('label', String.fromCharCode(65 + i)));
    }
    
    for (let i = 0; i < GRID_SIZE; i++) {
        gridElement.appendChild(createCell('label', i + 1));
        
        for (let j = 0; j < GRID_SIZE; j++) {
            const cell = createCell('cell');
            cell.dataset.x = j;
            cell.dataset.y = i;
            gridElement.appendChild(cell);
        }
    }
}

function createCell(className, text = '') {
    const cell = document.createElement('div');
    cell.classList.add(className);
    cell.textContent = text;
    return cell;
}

function placeShip(grid, ships, ship, x, y, isHorizontal) {
    if (canPlaceShip(grid, ship.size, x, y, isHorizontal)) {
        const newShip = { ...ship, positions: [], isSunk: false };
        for (let i = 0; i < ship.size; i++) {
            if (isHorizontal) {
                grid[y][x + i] = 1;
                newShip.positions.push({ x: x + i, y });
            } else {
                grid[y + i][x] = 1;
                newShip.positions.push({ x, y: y + i });
            }
        }
        ships.push(newShip);
        return true;
    }
    return false;
}

function canPlaceShip(grid, size, x, y, isHorizontal) {
    for (let i = 0; i < size; i++) {
        if (isHorizontal) {
            if (x + i >= GRID_SIZE || grid[y][x + i] !== 0) return false;
        } else {
            if (y + i >= GRID_SIZE || grid[y + i][x] !== 0) return false;
        }
    }
    return true;
}

function placeAIShips() {
    SHIPS.forEach(ship => {
        let placed = false;
        while (!placed) {
            const x = Math.floor(Math.random() * GRID_SIZE);
            const y = Math.floor(Math.random() * GRID_SIZE);
            const isHorizontal = Math.random() < 0.5;
            placed = placeShip(aiGrid, aiShips, ship, x, y, isHorizontal);
        }
    });
}

function updateGrid(gridId, grid, showShips = true) {
    const cells = document.querySelectorAll(`#${gridId} .cell`);
    cells.forEach(cell => {
        const x = parseInt(cell.dataset.x);
        const y = parseInt(cell.dataset.y);
        cell.className = 'cell';
        if (grid[y][x] === 1 && (showShips || gridId === 'player-grid')) cell.classList.add('ship');
        if (grid[y][x] === 2) cell.classList.add('miss');
        if (grid[y][x] === 3) cell.classList.add('hit');
        if (grid[y][x] === 4) cell.classList.add('sunk');
    });
}

function playerAttack(x, y) {
    if (aiGrid[y][x] === 0) {
        aiGrid[y][x] = 2; // Miss
        return false;
    } else if (aiGrid[y][x] === 1) {
        aiGrid[y][x] = 3; // Hit
        if (checkSunk(aiGrid, aiShips, x, y)) {
            playerSunkShips++;
        }
        return true;
    }
    return false;
}

function aiAttack() {
    let x, y;

    if (aiHuntMode) {
        if (aiHuntQueue.length > 0) {
            [x, y] = aiHuntQueue.shift();
        } else {
            aiHuntMode = false;
            aiLastHit = null;
            return aiAttack();
        }
    } else {
        do {
            x = Math.floor(Math.random() * GRID_SIZE);
            y = Math.floor(Math.random() * GRID_SIZE);
        } while (playerGrid[y][x] > 1);
    }

    const cell = document.querySelector(`#player-grid .cell[data-x="${x}"][data-y="${y}"]`);
    cell.classList.add('firing');
    setTimeout(() => cell.classList.remove('firing'), 500);

    if (playerGrid[y][x] === 0) {
        playerGrid[y][x] = 2; // Miss
        return false;
    } else if (playerGrid[y][x] === 1) {
        playerGrid[y][x] = 3; // Hit
        if (checkSunk(playerGrid, playerShips, x, y)) {
            aiSunkShips++;
        }
        aiHuntMode = true;
        aiLastHit = {x, y};
        updateAIHuntQueue(x, y);
        return true;
    }
}

function updateAIHuntQueue(x, y) {
    const directions = [{dx: 1, dy: 0}, {dx: -1, dy: 0}, {dx: 0, dy: 1}, {dx: 0, dy: -1}];
    for (let dir of directions) {
        let newX = x + dir.dx;
        let newY = y + dir.dy;
        if (newX >= 0 && newX < GRID_SIZE && newY >= 0 && newY < GRID_SIZE && playerGrid[newY][newX] <= 1) {
            aiHuntQueue.push([newX, newY]);
        }
    }
}

function checkSunk(grid, ships, x, y) {
    const hitShip = ships.find(ship => ship.positions.some(pos => pos.x === x && pos.y === y));
    if (hitShip) {
        const allHit = hitShip.positions.every(pos => grid[pos.y][pos.x] === 3);
        if (allHit) {
            hitShip.positions.forEach(pos => grid[pos.y][pos.x] = 4);
            hitShip.isSunk = true;
            if (grid === playerGrid) {
                aiHuntMode = false;
                aiLastHit = null;
                aiHuntQueue = [];
            }
            updateShipStatus();
            return true;
        }
    }
    return false;
}

function isGameOver() {
    return playerSunkShips === SHIPS.length || aiSunkShips === SHIPS.length;
}

function startGame() {
    initGrid(playerGrid);
    initGrid(aiGrid);
    createGridDOM('player-grid');
    createGridDOM('ai-grid');
    playerShips = [];
    aiShips = [];
    placeAIShips();
    currentShipIndex = 0;
    isPlacingShips = true;
    isPlayerTurn = true;
    gameOver = false;
    isHorizontal = true;
    aiLastHit = null;
    aiHuntMode = false;
    aiHuntQueue = [];
    playerSunkShips = 0;
    aiSunkShips = 0;
    updateStatus("Place your ships (use mouse wheel to rotate)");
    
    document.getElementById('player-grid').addEventListener('click', handlePlayerGridClick);
    document.getElementById('player-grid').addEventListener('mousemove', handlePlayerGridHover);
    document.getElementById('player-grid').addEventListener('wheel', handlePlayerGridWheel);
    document.getElementById('ai-grid').addEventListener('click', handleAIGridClick);
    document.getElementById('restart').style.display = 'none';
    
    updateGrid('player-grid', playerGrid);
    updateGrid('ai-grid', aiGrid, false);
    updateShipStatus();
}

function handlePlayerGridClick(event) {
    if (!isPlacingShips || !event.target.classList.contains('cell')) return;
    
    const x = parseInt(event.target.dataset.x);
    const y = parseInt(event.target.dataset.y);
    
    if (placeShip(playerGrid, playerShips, SHIPS[currentShipIndex], x, y, isHorizontal)) {
        updateGrid('player-grid', playerGrid);
        currentShipIndex++;
        if (currentShipIndex >= SHIPS.length) {
            isPlacingShips = false;
            updateStatus("Your turn to attack!");
        } else {
            updateStatus(`Place a ${SHIPS[currentShipIndex].name} (size: ${SHIPS[currentShipIndex].size}) (use mouse wheel to rotate)`);
        }
        updateShipStatus();
    }
}

function handlePlayerGridHover(event) {
    if (!isPlacingShips || !event.target.classList.contains('cell')) return;

    const x = parseInt(event.target.dataset.x);
    const y = parseInt(event.target.dataset.y);

    document.querySelectorAll('#player-grid .ship-preview').forEach(cell => cell.classList.remove('ship-preview'));

    if (canPlaceShip(playerGrid, SHIPS[currentShipIndex].size, x, y, isHorizontal)) {
        for (let i = 0; i < SHIPS[currentShipIndex].size; i++) {
            const previewCell = document.querySelector(`#player-grid .cell[data-x="${isHorizontal ? x + i : x}"][data-y="${isHorizontal ? y : y + i}"]`);
            if (previewCell) previewCell.classList.add('ship-preview');
        }
    }
}

function handlePlayerGridWheel(event) {
    if (!isPlacingShips) return;
    event.preventDefault();
    isHorizontal = !isHorizontal;
    handlePlayerGridHover(event);
}

function handleAIGridClick(event) {
    if (isPlacingShips || !isPlayerTurn || gameOver || !event.target.classList.contains('cell')) return;
    
    const x = parseInt(event.target.dataset.x);
    const y = parseInt(event.target.dataset.y);
    
    event.target.classList.add('firing');
    setTimeout(() => event.target.classList.remove('firing'), 500);

    playerAttack(x, y);
    updateGrid('ai-grid', aiGrid, false);
    
    if (checkGameOver()) return;
    
    isPlayerTurn = false;
    updateStatus("AI's turn.");
    setTimeout(aiTurn, 1000);
}

function aiTurn() {
    aiAttack();
    updateGrid('player-grid', playerGrid);
    
    if (checkGameOver()) return;
    
    isPlayerTurn = true;
    updateStatus("Your turn to attack!");
}

function checkGameOver() {
    if (isGameOver()) {
        gameOver = true;
        const winner = playerSunkShips === SHIPS.length ? "You" : "AI";
        if (winner === "You") {
            playerScore++;
        } else {
            aiScore++;
        }
        updateScore();
        updateStatus(`Game over! ${winner} won!`);
        document.getElementById('restart').style.display = 'block';
        return true;
    }
    return false;
}

function updateStatus(message) {
    document.getElementById('status').textContent = message;
}

function updateScore() {
    document.getElementById('player-score').textContent = playerScore;
    document.getElementById('ai-score').textContent = aiScore;
}

function updateShipStatus() {
    const playerShipTable = document.getElementById('player-ships');
    const aiShipTable = document.getElementById('ai-ships');

    playerShipTable.innerHTML = '<tr><th>Ship</th><th>Status</th></tr>';
    aiShipTable.innerHTML = '<tr><th>Ship</th><th>Status</th></tr>';

    SHIPS.forEach((ship, index) => {
        const playerShipRow = playerShipTable.insertRow();
        const aiShipRow = aiShipTable.insertRow();

        const playerShipStatus = playerShips[index]?.isSunk ? 'Sunk' : 'Afloat';
        const aiShipStatus = aiShips[index]?.isSunk ? 'Sunk' : 'Afloat';

        playerShipRow.innerHTML = `<td>${ship.name}</td><td class="${playerShipStatus.toLowerCase()}">${playerShipStatus}</td>`;
        aiShipRow.innerHTML = `<td>${ship.name}</td><td class="${aiShipStatus.toLowerCase()}">${aiShipStatus}</td>`;
    });
}
document.getElementById('restart').addEventListener('click', startGame);

startGame();
