const GRID_SIZE = 10;
const SHIP_ASSET_BASE = (() => {
    const script = document.querySelector('script[src*="gameJS.js"]');
    if (script?.src) return script.src.replace(/scripts\/gameJS\.js.*$/, "assets/ships/");
    return "public/assets/ships/";
})();

const SHIPS = [
    { name: "Carrier", size: 5, asset: "carrier.svg" },
    { name: "Battleship", size: 4, asset: "battleship.svg" },
    { name: "Cruiser", size: 3, asset: "cruiser.svg" },
    { name: "Submarine", size: 3, asset: "submarine.svg" },
    { name: "Destroyer", size: 2, asset: "destroyer.svg" }
];

function shipAssetUrl(filename) {
    return `${SHIP_ASSET_BASE}${filename}`;
}

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
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ===== UI Motion Helpers (Anime.js) ===== */
function canAnimate() {
    return typeof anime !== "undefined" && !prefersReducedMotion;
}

function runIntroAnimations() {
    if (!canAnimate()) {
        document.querySelectorAll(".anim-enter").forEach((el) => {
            el.style.opacity = "1";
            el.style.transform = "none";
        });
        return;
    }

    anime({
        targets: ".anim-enter",
        opacity: [0, 1],
        translateY: [24, 0],
        duration: 720,
        delay: anime.stagger(90, { start: 80 }),
        easing: "easeOutCubic"
    });

    anime({
        targets: ".brand-title",
        letterSpacing: ["0.28em", "0.12em"],
        duration: 1100,
        easing: "easeOutExpo"
    });
}

function animateStatus() {
    const el = document.getElementById("status");
    if (!el || !canAnimate()) return;

    anime.remove(el);
    anime({
        targets: el,
        scale: [0.96, 1],
        opacity: [0.35, 1],
        duration: 380,
        easing: "easeOutBack"
    });
}

function animateScoreBump(id) {
    const el = document.getElementById(id);
    if (!el || !canAnimate()) return;

    anime({
        targets: el,
        scale: [1, 1.35, 1],
        duration: 480,
        easing: "easeOutElastic(1, .6)"
    });
}

function animateCellImpact(cell, kind) {
    if (!cell || !canAnimate()) return;

    if (kind === "hit") {
        anime({
            targets: cell,
            scale: [1, 1.35, 1],
            duration: 420,
            easing: "easeOutExpo"
        });
    } else if (kind === "miss") {
        anime({
            targets: cell,
            opacity: [0.4, 1],
            scale: [0.85, 1],
            duration: 320,
            easing: "easeOutQuad"
        });
    } else if (kind === "sunk") {
        anime({
            targets: cell,
            scale: [1, 1.2, 1],
            rotate: ["0deg", "3deg", "-3deg", "0deg"],
            duration: 520,
            easing: "easeOutQuad"
        });
    }
}

function animateShipPlacement(cells) {
    if (!cells.length || !canAnimate()) return;

    anime({
        targets: cells,
        scale: [0.7, 1],
        opacity: [0.4, 1],
        delay: anime.stagger(45),
        duration: 360,
        easing: "easeOutBack"
    });
}

function animateRotateButton() {
    const btn = document.getElementById("rotate-ship");
    if (!btn || !canAnimate()) return;

    anime({
        targets: btn,
        rotate: "+=90",
        duration: 320,
        easing: "easeOutBack"
    });
}

function celebrateWin(playerWon) {
    if (typeof confetti === "undefined" || prefersReducedMotion) return;

    const colors = playerWon
        ? ["#1f6f8b", "#a7d7e0", "#c8a24a", "#e8f2f4"]
        : ["#e24a3b", "#94a3b8", "#64748b"];

    confetti({
        particleCount: playerWon ? 120 : 50,
        spread: 70,
        origin: { y: 0.65 },
        colors
    });

    if (playerWon) {
        setTimeout(() => {
            confetti({
                particleCount: 80,
                angle: 60,
                spread: 55,
                origin: { x: 0, y: 0.7 },
                colors
            });
            confetti({
                particleCount: 80,
                angle: 120,
                spread: 55,
                origin: { x: 1, y: 0.7 },
                colors
            });
        }, 220);
    }
}

function pulseRestartButton() {
    const btn = document.getElementById("restart");
    if (!btn || !canAnimate()) return;

    anime({
        targets: btn,
        scale: [0.85, 1],
        opacity: [0, 1],
        duration: 500,
        easing: "easeOutBack"
    });
}

function setPlacementHintVisible(visible) {
    const hint = document.getElementById("placement-hint");
    if (!hint) return;
    hint.classList.toggle("hidden", !visible);
}

/* ===== Theme Switcher ===== */
const THEME_ALIASES = {
    abyss: "atlantic",
    volt: "brass",
    arctic: "regatta",
    iceberg: "regatta"
};
const VALID_THEMES = ["atlantic", "brass", "regatta"];

function resolveTheme(theme) {
    const mapped = THEME_ALIASES[theme] || theme;
    return VALID_THEMES.includes(mapped) ? mapped : "atlantic";
}

function applyTheme(theme) {
    const next = resolveTheme(theme);
    document.body.setAttribute("data-theme", next);
    localStorage.setItem("battleship-theme", next);
    document.querySelectorAll(".theme-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.theme === next);
    });
}

function initThemeSwitcher() {
    applyTheme(localStorage.getItem("battleship-theme") || "atlantic");

    document.querySelectorAll(".theme-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            applyTheme(btn.dataset.theme);

            if (canAnimate()) {
                anime({
                    targets: "body",
                    opacity: [0.85, 1],
                    duration: 280,
                    easing: "easeOutQuad"
                });
            }
        });
    });
}

/* ===== Game Core ===== */
function initGrid(grid) {
    for (let i = 0; i < GRID_SIZE; i++) {
        grid[i] = new Array(GRID_SIZE).fill(0);
    }
}

function ensureShipLayer(gridId) {
    const gridElement = document.getElementById(gridId);
    let stage = gridElement.closest(".grid-stage");
    if (!stage) {
        stage = document.createElement("div");
        stage.className = "grid-stage";
        gridElement.parentNode.insertBefore(stage, gridElement);
        stage.appendChild(gridElement);
    }

    const layerId = `${gridId}-ships-layer`;
    let layer = document.getElementById(layerId);
    if (!layer) {
        layer = document.createElement("div");
        layer.id = layerId;
        layer.className = "ships-layer";
        layer.setAttribute("aria-hidden", "true");
        stage.insertBefore(layer, gridElement);
    }
    return layer;
}

function createGridDOM(gridId) {
    const gridElement = document.getElementById(gridId);
    gridElement.innerHTML = "";
    const layer = ensureShipLayer(gridId);
    layer.innerHTML = "";

    gridElement.appendChild(createCell("label", ""));
    for (let i = 0; i < GRID_SIZE; i++) {
        gridElement.appendChild(createCell("label", String.fromCharCode(65 + i)));
    }

    for (let i = 0; i < GRID_SIZE; i++) {
        gridElement.appendChild(createCell("label", i + 1));

        for (let j = 0; j < GRID_SIZE; j++) {
            const cell = createCell("cell");
            cell.dataset.x = j;
            cell.dataset.y = i;
            gridElement.appendChild(cell);
        }
    }
}

function renderShipOverlays(gridId, ships, visible) {
    const gridElement = document.getElementById(gridId);
    const layer = ensureShipLayer(gridId);
    layer.innerHTML = "";
    if (!visible || !ships.length) return;

    const gridRect = gridElement.getBoundingClientRect();

    ships.forEach((ship) => {
        if (!ship.positions?.length || !ship.asset) return;

        const first = ship.positions[0];
        const last = ship.positions[ship.positions.length - 1];
        const horizontal = first.y === last.y;

        const startCell = gridElement.querySelector(`.cell[data-x="${first.x}"][data-y="${first.y}"]`);
        const endCell = gridElement.querySelector(`.cell[data-x="${last.x}"][data-y="${last.y}"]`);
        if (!startCell || !endCell) return;

        const startRect = startCell.getBoundingClientRect();
        const endRect = endCell.getBoundingClientRect();

        const sprite = document.createElement("img");
        sprite.className = "ship-sprite";
        sprite.src = shipAssetUrl(ship.asset);
        sprite.alt = ship.name;
        sprite.draggable = false;

        if (ship.isSunk) sprite.classList.add("is-sunk");
        else if (ship.positions.some((pos) => {
            const value = gridId === "player-grid" ? playerGrid[pos.y][pos.x] : aiGrid[pos.y][pos.x];
            return value >= 3;
        })) {
            sprite.classList.add("is-damaged");
        }

        if (horizontal) {
            sprite.style.left = `${startRect.left - gridRect.left}px`;
            sprite.style.top = `${startRect.top - gridRect.top}px`;
            sprite.style.width = `${endRect.right - startRect.left}px`;
            sprite.style.height = `${startRect.height}px`;
        } else {
            const width = endRect.bottom - startRect.top;
            const height = startRect.width;
            const left = startRect.left - gridRect.left - (width - height) / 2;
            const top = startRect.top - gridRect.top + (width - height) / 2;
            sprite.style.left = `${left}px`;
            sprite.style.top = `${top}px`;
            sprite.style.width = `${width}px`;
            sprite.style.height = `${height}px`;
            sprite.classList.add("vertical");
        }

        layer.appendChild(sprite);
    });
}

function createCell(className, text = "") {
    const cell = document.createElement("div");
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
    SHIPS.forEach((ship) => {
        let placed = false;
        while (!placed) {
            const x = Math.floor(Math.random() * GRID_SIZE);
            const y = Math.floor(Math.random() * GRID_SIZE);
            const horizontal = Math.random() < 0.5;
            placed = placeShip(aiGrid, aiShips, ship, x, y, horizontal);
        }
    });
}

function updateGrid(gridId, grid, showShips = true) {
    const cells = document.querySelectorAll(`#${gridId} .cell`);
    cells.forEach((cell) => {
        const x = parseInt(cell.dataset.x, 10);
        const y = parseInt(cell.dataset.y, 10);
        cell.className = "cell";
        if (grid[y][x] === 1 && (showShips || gridId === "player-grid")) cell.classList.add("ship");
        if (grid[y][x] === 2) cell.classList.add("miss");
        if (grid[y][x] === 3) cell.classList.add("hit");
        if (grid[y][x] === 4) cell.classList.add("sunk");
    });

    if (gridId === "player-grid") {
        renderShipOverlays("player-grid", playerShips, true);
    } else {
        // Reveal sunk enemy ships with their assets
        const sunkShips = aiShips.filter((ship) => ship.isSunk);
        renderShipOverlays("ai-grid", sunkShips, true);
    }
}

function playerAttack(x, y) {
    if (aiGrid[y][x] === 0) {
        aiGrid[y][x] = 2;
        return "miss";
    } else if (aiGrid[y][x] === 1) {
        aiGrid[y][x] = 3;
        const sunk = checkSunk(aiGrid, aiShips, x, y);
        if (sunk) playerSunkShips++;
        return sunk ? "sunk" : "hit";
    }
    return "invalid";
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
    if (cell) {
        cell.classList.add("firing");
        setTimeout(() => cell.classList.remove("firing"), 500);
    }

    if (playerGrid[y][x] === 0) {
        playerGrid[y][x] = 2;
        animateCellImpact(cell, "miss");
        return false;
    } else if (playerGrid[y][x] === 1) {
        playerGrid[y][x] = 3;
        const sunk = checkSunk(playerGrid, playerShips, x, y);
        if (sunk) {
            aiSunkShips++;
            animateCellImpact(cell, "sunk");
        } else {
            animateCellImpact(cell, "hit");
        }
        aiHuntMode = true;
        aiLastHit = { x, y };
        updateAIHuntQueue(x, y);
        return true;
    }
}

function updateAIHuntQueue(x, y) {
    const directions = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
    ];
    for (const dir of directions) {
        const newX = x + dir.dx;
        const newY = y + dir.dy;
        if (newX >= 0 && newX < GRID_SIZE && newY >= 0 && newY < GRID_SIZE && playerGrid[newY][newX] <= 1) {
            aiHuntQueue.push([newX, newY]);
        }
    }
}

function checkSunk(grid, ships, x, y) {
    const hitShip = ships.find((ship) => ship.positions.some((pos) => pos.x === x && pos.y === y));
    if (hitShip) {
        const allHit = hitShip.positions.every((pos) => grid[pos.y][pos.x] === 3);
        if (allHit) {
            hitShip.positions.forEach((pos) => {
                grid[pos.y][pos.x] = 4;
            });
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
    createGridDOM("player-grid");
    createGridDOM("ai-grid");
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
    updateStatus("Place your ships — rotate to fit");
    setPlacementHintVisible(true);

    const playerGridEl = document.getElementById("player-grid");
    const aiGridEl = document.getElementById("ai-grid");
    playerGridEl.addEventListener("click", handlePlayerGridClick);
    playerGridEl.addEventListener("mousemove", handlePlayerGridHover);
    playerGridEl.addEventListener("wheel", handlePlayerGridWheel, { passive: false });
    aiGridEl.addEventListener("click", handleAIGridClick);
    document.getElementById("restart").style.display = "none";

    updateGrid("player-grid", playerGrid);
    updateGrid("ai-grid", aiGrid, false);
    updateShipStatus();
    document.getElementById("rotate-ship").style.display = "inline-flex";

    if (canAnimate()) {
        anime({
            targets: "#player-grid .cell, #ai-grid .cell",
            opacity: [0, 1],
            scale: [0.6, 1],
            delay: anime.stagger(4, { grid: [10, 10], from: "center" }),
            duration: 420,
            easing: "easeOutQuad"
        });
    }
}

function handlePlayerGridClick(event) {
    if (!isPlacingShips || !event.target.classList.contains("cell")) return;

    const x = parseInt(event.target.dataset.x, 10);
    const y = parseInt(event.target.dataset.y, 10);

    if (placeShip(playerGrid, playerShips, SHIPS[currentShipIndex], x, y, isHorizontal)) {
        updateGrid("player-grid", playerGrid);

        const placedCells = [];
        for (let i = 0; i < SHIPS[currentShipIndex].size; i++) {
            const cx = isHorizontal ? x + i : x;
            const cy = isHorizontal ? y : y + i;
            const cell = document.querySelector(`#player-grid .cell[data-x="${cx}"][data-y="${cy}"]`);
            if (cell) placedCells.push(cell);
        }
        animateShipPlacement(placedCells);

        currentShipIndex++;
        if (currentShipIndex >= SHIPS.length) {
            isPlacingShips = false;
            updateStatus("Your turn — fire on enemy waters!");
            document.getElementById("rotate-ship").style.display = "none";
            setPlacementHintVisible(false);

            if (canAnimate()) {
                anime({
                    targets: "#ai-panel",
                    scale: [0.98, 1],
                    duration: 400,
                    easing: "easeOutBack"
                });
            }
        } else {
            updateStatus(`Place ${SHIPS[currentShipIndex].name} (${SHIPS[currentShipIndex].size})`);
        }
        updateShipStatus();
    }
}

function handlePlayerGridHover(event) {
    if (!isPlacingShips || !event.target.classList.contains("cell")) return;

    const x = parseInt(event.target.dataset.x, 10);
    const y = parseInt(event.target.dataset.y, 10);

    document.querySelectorAll("#player-grid .ship-preview").forEach((cell) => cell.classList.remove("ship-preview"));

    if (canPlaceShip(playerGrid, SHIPS[currentShipIndex].size, x, y, isHorizontal)) {
        for (let i = 0; i < SHIPS[currentShipIndex].size; i++) {
            const previewCell = document.querySelector(
                `#player-grid .cell[data-x="${isHorizontal ? x + i : x}"][data-y="${isHorizontal ? y : y + i}"]`
            );
            if (previewCell) previewCell.classList.add("ship-preview");
        }
    }
}

function handlePlayerGridWheel(event) {
    if (!isPlacingShips) return;
    event.preventDefault();
    isHorizontal = !isHorizontal;
    animateRotateButton();
    handlePlayerGridHover(event);
}

function handleAIGridClick(event) {
    if (isPlacingShips || !isPlayerTurn || gameOver || !event.target.classList.contains("cell")) return;

    const x = parseInt(event.target.dataset.x, 10);
    const y = parseInt(event.target.dataset.y, 10);

    if (aiGrid[y][x] > 1) return;

    event.target.classList.add("firing");
    setTimeout(() => event.target.classList.remove("firing"), 500);

    const result = playerAttack(x, y);
    updateGrid("ai-grid", aiGrid, false);

    const cell = document.querySelector(`#ai-grid .cell[data-x="${x}"][data-y="${y}"]`);
    if (result === "hit" || result === "sunk") {
        animateCellImpact(cell, result);
        if (result === "sunk") updateStatus("Direct hit — ship sunk!");
        else updateStatus("Hit!");
    } else if (result === "miss") {
        animateCellImpact(cell, "miss");
    } else {
        return;
    }

    if (checkGameOver()) return;

    isPlayerTurn = false;
    updateStatus("AI is targeting…");
    setTimeout(aiTurn, 900);
}

function aiTurn() {
    aiAttack();
    updateGrid("player-grid", playerGrid);

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
            animateScoreBump("player-score");
        } else {
            aiScore++;
            animateScoreBump("ai-score");
        }
        updateScore();
        updateStatus(winner === "You" ? "Victory! Fleet destroyed the enemy." : "Defeat — AI took the seas.");
        document.getElementById("restart").style.display = "block";
        celebrateWin(winner === "You");
        pulseRestartButton();
        return true;
    }
    return false;
}

function updateStatus(message) {
    document.getElementById("status").textContent = message;
    animateStatus();
}

function updateScore() {
    document.getElementById("player-score").textContent = playerScore;
    document.getElementById("ai-score").textContent = aiScore;
}

function updateShipStatus() {
    const playerShipTable = document.getElementById("player-ships");
    const aiShipTable = document.getElementById("ai-ships");

    playerShipTable.innerHTML = "<tr><th>Ship</th><th>Status</th></tr>";
    aiShipTable.innerHTML = "<tr><th>Ship</th><th>Status</th></tr>";

    SHIPS.forEach((ship, index) => {
        const playerShipRow = playerShipTable.insertRow();
        const aiShipRow = aiShipTable.insertRow();

        const playerShipStatus = playerShips[index]?.isSunk ? "Sunk" : "Afloat";
        const aiShipStatus = aiShips[index]?.isSunk ? "Sunk" : "Afloat";
        const icon = `<img class="ship-icon" src="${shipAssetUrl(ship.asset)}" alt="" loading="lazy">`;

        playerShipRow.className = playerShipStatus === "Sunk" ? "row-sunk" : "row-afloat";
        aiShipRow.className = aiShipStatus === "Sunk" ? "row-sunk" : "row-afloat";

        playerShipRow.innerHTML = `<td><span class="ship-name">${icon}<span>${ship.name}</span></span></td><td class="${playerShipStatus.toLowerCase()}">${playerShipStatus}</td>`;
        aiShipRow.innerHTML = `<td><span class="ship-name">${icon}<span>${ship.name}</span></span></td><td class="${aiShipStatus.toLowerCase()}">${aiShipStatus}</td>`;
    });
}

document.getElementById("restart").addEventListener("click", startGame);
document.getElementById("rotate-ship").addEventListener("click", () => {
    if (isPlacingShips) {
        isHorizontal = !isHorizontal;
        animateRotateButton();
        const hoveredCell = document.querySelector("#player-grid .ship-preview");
        if (hoveredCell) {
            handlePlayerGridHover({ target: hoveredCell });
        }
    }
});

let shipOverlayResizeTimer = null;
window.addEventListener("resize", () => {
    clearTimeout(shipOverlayResizeTimer);
    shipOverlayResizeTimer = setTimeout(() => {
        renderShipOverlays("player-grid", playerShips, true);
        renderShipOverlays("ai-grid", aiShips.filter((ship) => ship.isSunk), true);
    }, 120);
});

initThemeSwitcher();
startGame();
runIntroAnimations();
