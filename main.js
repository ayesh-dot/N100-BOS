/**
 * BASTION ENGINE v1.0
 * -------------------------------------------------------------------------
 * PROJECT: N100-BOS
 * DEVELOPER: Ayesh Abulehieh
 * 
 * CORE SYSTEMS:
 * - Rendering: Canvas-based grid with integrated panning, zoom, and province data.
 * - Navigation: Eight-direction movement utilizing Chebyshev Distance logic.
 * - AI & Logic: 
 *      * Dynamic frontlines powered by a custom BFS scanner.
 *      * Multi-personality AI (Strategist, Berserker, Predator) with 
 *        automated reinforcement and a multiple-front based engine.
 * -------------------------------------------------------------------------
*/

//#region GLOBALS

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let tileSize = 50;
const gridWidth = 40;
const gridHeight = 40;
let cameraX = 0;
let cameraY = 0;
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let selectedProvince = null;
let zoom = 1;
let supply = 1; //ill have supply at 1 for now


let isBoxSelecting = false;
let isDraggingArrow = false;
let currentPath = [];
let boxStartWorld = { x: 0, y: 0 };
let boxEndWorld = { x: 0, y: 0 };
let selectedDivisions = [];
let divisionIdIncrement = 0;

let gameTick = 0;
let tickRate = 250; // 1000ms = exactly 1 second
let isPaused = true;
let gameDay = 1;
let gameMonth = 1;
let gameYear = 2026;
const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

let battles = [];
let battleCounter = 0;
let startX;
let startY;

let enemyDivisions = [];
let retreatTracker = [];
let aiAttackTick = 0;

//#endregion

//region GAMETICK
function onTick() {
    if (isPaused == true) return;
    //#region DATE LOGIC
    gameTick++;
    gameDay++;

    if (gameDay > daysInMonth[gameMonth - 1]) { gameDay = 1; gameMonth++; }
    if (gameMonth > 12) { gameMonth = 1; gameYear++; }

    //#endregion

    provinces.forEach(p => {
        for (let i = p.divisions.length - 1; i >= 0; i--) {
            let unit = p.divisions[i];
            
            if (unit && unit.targetX !== undefined && unit.lastMoveTick !== gameTick) {
                const isFighting = battles.find(b => b.attackerUnit === unit || b.defenderUnit === unit);
                if (isFighting) continue;

                // 1. Calculate the coordinates of the very next tile
                let nextX = p.x + Math.sign(unit.targetX - p.x);
                let nextY = p.y + Math.sign(unit.targetY - p.y);

                // 2. CHECK: Are we already there?
                if (nextX === p.x && nextY === p.y) {
                    // UNIT HAS ARRIVED: Clear targets so it stops moving
                    unit.targetX = undefined;
                    unit.targetY = undefined;
                    console.log("Unit arrived at destination!");
                    continue; 
                }

                // 3. If we aren't there, take the step
                // 3. If we aren't there, take the step
                let nextProvince = getProvinces(nextX, nextY);

                if (nextProvince) {
                    // THE FIX: Allow movement if the tile is empty OR if it belongs to an ENEMY (to start a fight)
                    const isFriendlyOccupied = nextProvince.divisions.length > 0 && nextProvince.owner === p.owner;

                    if (!isFriendlyOccupied) {
                        unit.lastMoveTick = gameTick;
                        moveUnit(p, nextProvince, i);
                    } 
                }

            }

            if(unit && unit.isInBattle === false && unit.currentOrg < 1){
                unit.currentOrg = Math.min(1, unit.currentOrg + 0.01);
            };

            if(unit && unit.isInBattle === false && unit.strength < 1){
                unit.strength = Math.min(1, unit.strength + 0.0025);
            };

        }

        p.frontLineStatus = p.neighbors.some(n => n.owner !== p.owner);

        if(p.frontLineStatus == true && p.divisions.length == 0){
            // CHECK: Is someone already on their way to this specific tile?
            let alreadyHasReinforcement = provinces.some(prov => 
                prov.divisions.some(d => d.targetX === p.x && d.targetY === p.y)
            );

            // Only call for help if NO ONE is already coming
            if (!alreadyHasReinforcement) {
                callFreeDivision(p);
            }
        }


        if (p.divisions.length > 1) {

            const unitIsFighting = battles.some(b => b.attackerUnit == p.divisions[0] || b.defenderUnit == p.divisions[0]);
            if(!unitIsFighting){
                p.divisions[0].isInBattle = false;
            };
            let targetProvince = p.neighbors.find(n => 
                n.owner === p.owner && 
                n.divisions.length === 0 && 
                n.frontLineStatus === true
            );

            if (!targetProvince) {
                targetProvince = p.neighbors.find(n => n.owner === p.owner && n.divisions.length === 0);
            }

            if (targetProvince) {
                const unit = p.divisions[1]; // Take the spare
                if (unit.targetX === undefined) {
                    unit.targetX = targetProvince.x;
                    unit.targetY = targetProvince.y;
                }
            }
        }

    });


    battles = battles.filter(b => b.defenderUnit?.isInBattle && b.attackerUnit?.isInBattle);


    battles.forEach(b => {
        // SAFETY: Prevents crash if units are missing
        if (!b.attackerUnit || !b.defenderUnit) return;
        if (!b.defenderUnit?.isInBattle && !b.attackerUnit?.isInBattle) return;
        
        b.attackerUnit.currentOrg = Math.max(0, b.attackerUnit.currentOrg - (b.defenderOrgDamage || 0));
        b.defenderUnit.currentOrg = Math.max(0, b.defenderUnit.currentOrg - (b.attackerOrgDamage || 0));
        
        const sidebar = document.getElementById('selection-sidebar');
        if(sidebar && window.getComputedStyle(sidebar).visibility === "visible"){
            updateSidebar();
        };
    });

    battles = battles.filter(b => {
        const defender = b.defenderUnit;
        const attacker = b.attackerUnit;
        const location = b.location; 
        const fromProv = b.fromProvince;

        if (!location || !fromProv || !defender || !attacker) return false;

        // --- CASE 1: DEFENDER LOSES ---
        if (defender.currentOrg <= 0) {
            let retreatTile = null;
            if (location.neighbors) {
                // Try to find a friendly tile that isn't where the attack came from
                retreatTile = location.neighbors.find(n => n.owner === defender.permanentOwner && n !== fromProv);

                
                // FALLBACK: If that fails, just find ANY friendly tile
                if (!retreatTile) {
                    retreatTile = location.neighbors.find(n => n.owner !== defender.owner);
                }
            }
            
            if (retreatTile) {
                retreatTile.divisions.push(defender);
                defender.strength -= 0.5; 
                defender.currentOrg = 0.5;
                defender.isRetreating = true;
            } else {
                // Truly surrounded; unit gets deleted.
            }

            defender.isInBattle = false;
            attacker.isInBattle = false;
            defender.targetX = undefined;
            defender.targetY = undefined;

            // REMOVE defender
            location.divisions = location.divisions.filter(u => u.id !== defender.id);

            // CAPTURE & MOVE ATTACKER
            if (location.divisions.length === 0) {
                location.owner = fromProv.owner;
                location.divisions.push(attacker);
                fromProv.divisions = fromProv.divisions.filter(u => u.id !== attacker.id);
                
                if (location.owner !== "Enemy") {
                    retreatTracker.push(attacker.id);
                }
            }

            return false; 
        }


        // --- CASE 2: ATTACKER LOSES ---
        if (attacker.currentOrg <= 0) {
            attacker.strength -= 0.4; // Your original value
            defender.strength -= 0.1;

            defender.isInBattle = false;
            attacker.isInBattle = false;
            attacker.currentOrg = 0.5;
            
            attacker.targetX = undefined;
            attacker.targetY = undefined;

            return false; // End this battle
        }

        return true; // Battle continues
    });


    battles = battles.filter(b => b.defenderUnit?.isInBattle && b.attackerUnit?.isInBattle);

    enemyDivisions = provinces.filter(p => p.owner == "Enemy" && p.divisions.length > 0);


    // const sidebar = document.getElementById('selection-sidebar');
    // if(sidebar && window.getComputedStyle(sidebar).visibility === "visible"){
    //     updateSidebar();
    // };

    // provinces.forEach(p => {
    //     if(p.divisions[0].permanentOwner != p.owner){
    //         p.owner = p.divisions[0].permanentOwner;
    //     };
    // });

}

setInterval(onTick, tickRate);
//#endregion
    
let unitTemplates = {
    "defaultInfantry": {
        softAttack: .05, // How much organization you lose for soft units.
        hardAttack: .01, // How much organization you lose for hard units.
        lethality: .02, // percentage of men you kill while attacking (still undecided; might just deduct form strength and then the refill logic deducts from the manpower).
        defense: .9, 
        speed: 4,
        hardness: 0,
        supplyUse: 0.05,
        entrenchmentGain: 0.1,
        maximumEntrenchment: 1
    }
};

//#region CHEBSYEV DISTANCE LOGIC & PROVINCE GENERATION
let provinces = [];
for (let x = 0; x < gridWidth; x++) {
    for (let y = 0; y < gridHeight; y++) {
        provinces.push({
            x: x,
            y: y,
            owner: x < 20 ? "Player" : "Enemy",
            terrain: Math.random() > 0.8 ? "mountain" : "plains",
            divisions: Math.random() > 0.8 ? [{
                id: `${divisionIdIncrement}`,
                currentOrg: 1,
                strength: 1,
                entrenchment: 1,
                isRetreating: false,
                composition: { "defaultInfantry": 1 },
                isInBattle: false,
                permanentOwner: false,
            }] : [],
            neighbors: [],
            frontLineStatus: null,
            maginotLineStatus: false
        });
        divisionIdIncrement++;
    }
}


function getProvinces(x,y){
    return provinces.find(p => p.x === x && p.y === y );
};

provinces.forEach(p => {
    // Add the 4 diagonal directions (1,1 / 1,-1 / -1,1 / -1,-1)
    const directions = [
        {x: 1, y: 0}, {x: -1, y: 0}, {x: 0, y: 1}, {x: 0, y: -1},
        {x: 1, y: 1}, {x: 1, y: -1}, {x: -1, y: 1}, {x: -1, y: -1}
    ];
    
    directions.forEach(dir => {
        let n = getProvinces(p.x + dir.x, p.y + dir.y);
        if (n) p.neighbors.push(n);
    });
});



provinces.forEach(p => {
    let isBorderingEnemy = p.neighbors.some(n => n.owner !== p.owner);
    let frontlineProvince = null;
    frontlineProvince = isBorderingEnemy ? true: false;
    if (isBorderingEnemy && p.divisions.length === 0) {
        p.divisions.push({
            id: `${divisionIdIncrement}`, 
            currentOrg: 1,
            strength: 1,
            entrenchment: 1,
            isRetreating: false,
            composition: { "defaultInfantry": 1 },
            isInBattle: false,
            permanentOwner: p.owner
        });
        divisionIdIncrement++;
    }

   p.frontLineStatus = isBorderingEnemy;
});

provinces.forEach(p => {
    if(p.divisions.length > 0 && !p.divisions[0].permanentOwner){
        p.divisions[0].permanentOwner = p.owner;
    };
});

//#endregion

document.getElementById('selection-sidebar').style.visibility = "hidden";

function updateSidebar(updateStats) {
    const container = document.getElementById('unit-list-container');
    const sidebar = document.getElementById('selection-sidebar');
    if (sidebar) sidebar.style.visibility = "visible";

    if (updateStats){
        statsRowDivider.innerHTML = "";
        statsRowDivider2.innerHTML = "";

        const statsRowDivider = document.getElementById('stats-row');
        const statsRowDivider2 = document.getElementById('stats-row2');

        const unitOrganizationHeader = document.createElement('h1');
        unitOrganizationHeader.classList = 'stat-header';
        unitOrganizationHeader.id = 'unit-organization';
        unitOrganizationHeader.textContent = "Org: ";

        const unitStrengthHeader = document.createElement('h1');
        unitStrengthHeader.classList = 'stats-header';
        unitStrengthHeader.id = 'unit-strength';
        unitStrengthHeader.textContent = "Strength: ";

        const orgMissing = 50 - (d.divisions[0].currentOrg * 50);
        const strMissing = 50 - (d.divisions[0].strength * 50);

        const sidebarOrgBar = document.createElement('div');
        sidebarOrgBar.id = 'sidebar-org';

        sidebarOrgBar.style.boxShadow = `inset -${orgMissing}px 0 0 0 #1a1a1a`;

        const sidebarStrengthBar = document.createElement('div');
        sidebarStrengthBar.id = 'sidebar-strength';
        sidebarStrengthBar.style.boxShadow = `inset -${strMissing}px 0 0 0 #1a1a1a`;

        statsRowDivider.appendChild(unitOrganizationHeader);
        statsRowDivider.appendChild(sidebarOrgBar);
        statsRowDivider2.appendChild(unitStrengthHeader);
        statsRowDivider2.appendChild(sidebarStrengthBar);


    };
    
    container.innerHTML = ""; 

    selectedDivisions.forEach(d => {
    const card = document.createElement('div');
    card.className = 'unit-card';
    
    const unitId = d.divisions[0]?.id || "Unknown"; // Added safety check

    const header = document.createElement('h1');
    header.textContent = `Infantry ${unitId} 🪖`;
    header.className = 'sidebar-header';

    const statsDivider = document.createElement('div');
    statsDivider.classList = 'stats-divider';

    const statsRowDivider = document.createElement('div');
    statsRowDivider.id = 'stats-row';
    const statsRowDivider2 = document.createElement('div');
    statsRowDivider2.id = 'stats-row2';

    const unitOrganizationHeader = document.createElement('h1');
    unitOrganizationHeader.classList = 'stat-header';
    unitOrganizationHeader.id = 'unit-organization';
    unitOrganizationHeader.textContent = "Org: ";

    const unitStrengthHeader = document.createElement('h1');
    unitStrengthHeader.classList = 'stats-header';
    unitStrengthHeader.id = 'unit-strength';
    unitStrengthHeader.textContent = "Strength: ";

    const orgMissing = 50 - (d.divisions[0].currentOrg * 50);
    const strMissing = 50 - (d.divisions[0].strength * 50);

    const sidebarOrgBar = document.createElement('div');
    sidebarOrgBar.id = 'sidebar-org';

    sidebarOrgBar.style.boxShadow = `inset -${orgMissing}px 0 0 0 #1a1a1a`;

    const sidebarStrengthBar = document.createElement('div');
    sidebarStrengthBar.id = 'sidebar-strength';
    sidebarStrengthBar.style.boxShadow = `inset -${strMissing}px 0 0 0 #1a1a1a`;


    const btn = document.createElement('button');
    btn.textContent = `❌`;
    btn.className = 'remove-selection-btn';
    

    btn.onclick = function() {
        removeUnitFromSelection(unitId);
    };

    card.appendChild(header);
    card.appendChild(statsDivider);
    
    statsDivider.appendChild(statsRowDivider);
    statsDivider.appendChild(statsRowDivider2);

    statsRowDivider.appendChild(unitOrganizationHeader);
    statsRowDivider.appendChild(sidebarOrgBar);
    statsRowDivider2.appendChild(unitStrengthHeader);
    statsRowDivider2.appendChild(sidebarStrengthBar);

    card.appendChild(btn);
    container.appendChild(card);
});
}



function removeUnitFromSelection(id){
    selectedDivisions = selectedDivisions.filter(p => p.divisions[0].id != id);
    updateSidebar();
    if (selectedDivisions.length === 0) {
        document.getElementById('selection-sidebar').style.visibility = "hidden";
    }
};



//#region DRAW LOGIC
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

function draw() {
    
    ctx.setTransform(1, 0, 0, 1, 0, 0); 
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    
    provinces.forEach(p => {
        let screenX = (p.x * tileSize + cameraX) * zoom;
        let screenY = (p.y * tileSize + cameraY) * zoom;
        let currentSize = tileSize * zoom;


        ctx.fillStyle = (p.terrain === "mountain") ? "#5a5a5a" : "#3d5e35"; 
        ctx.fillRect(screenX, screenY, currentSize, currentSize);
        
        if (selectedProvince === p) {
            ctx.strokeStyle = "#ffd322";
            let thickness = 3 * zoom;
            ctx.lineWidth = thickness;
            
            ctx.strokeRect(
                screenX + (thickness/2), 
                screenY + (thickness/2), 
                currentSize - thickness, 
                currentSize - thickness
            );
        }

        if (zoom < 0.8) {
            ctx.fillStyle = (p.owner === "Player") ? "rgba(0, 100, 255, 0.15)" : "rgba(255, 0, 0, 0.15)";
            ctx.fillRect(screenX, screenY, currentSize, currentSize);
        }


        if (zoom > 0.5) {
            ctx.strokeStyle = "rgba(0, 0, 0, 0.2)"; 
            ctx.strokeRect(screenX, screenY, currentSize, currentSize);
        }

        ctx.strokeStyle = "#ffd322";
        ctx.lineWidth = 1 * zoom;

        const targets = [
            { dx: 1, dy: 0, x1: 1, y1: 0, x2: 1, y2: 1 }, // Right side
            { dx: 0, dy: 1, x1: 0, y1: 1, x2: 1, y2: 1 }  // Bottom side
        ];

        targets.forEach(t => {
            let neighbor = provinces.find(n => n.x === p.x + t.dx && n.y === p.y + t.dy);
            if (neighbor && neighbor.owner !== p.owner) {
                ctx.beginPath();
                ctx.moveTo(screenX + t.x1 * currentSize, screenY + t.y1 * currentSize);
                ctx.lineTo(screenX + t.x2 * currentSize, screenY + t.y2 * currentSize);
                ctx.stroke();
            }
        });

        if (p.divisions && p.divisions.length > 0) {
            
            p.divisions.forEach((unit, index) => {
                const unitBoxSize = currentSize * 0.6;
                const offset = (currentSize - unitBoxSize) / 2;
                
                const stackX = (index * 4) * zoom;
                const stackY = (index * 4) * zoom;

                const ux = screenX + offset + stackX;
                const uy = screenY + offset - stackY;

                // Draw Box
                ctx.fillStyle = (p.owner === "Player") ? "#0064ff" : "#ff0000";
                ctx.fillRect(ux, uy, unitBoxSize, unitBoxSize);
                
                // Draw White Border
                ctx.strokeStyle = "white";
                ctx.lineWidth = 2 * zoom;
                ctx.strokeRect(ux, uy, unitBoxSize, unitBoxSize);

                // Draw NATO X
                ctx.beginPath();
                ctx.strokeStyle = "rgba(255, 255, 255, 0.8)"; 
                ctx.lineWidth = Math.max(1, 1.5 * zoom);
                ctx.moveTo(ux, uy);
                ctx.lineTo(ux + unitBoxSize, uy + unitBoxSize);
                ctx.moveTo(ux + unitBoxSize, uy);
                ctx.lineTo(ux, uy + unitBoxSize);
                ctx.stroke();

                const barHeight = 3 * zoom;
                ctx.fillStyle = "black";
                ctx.fillRect(ux, uy + unitBoxSize + 2, unitBoxSize, barHeight);
                ctx.fillStyle = "#00ff00";
                ctx.fillRect(ux, uy + unitBoxSize + 2, unitBoxSize * unit.currentOrg, barHeight);

                ctx.fillStyle = "black";
                ctx.fillRect(ux, (uy + unitBoxSize + 2) + (3 * zoom), unitBoxSize, barHeight);
                ctx.fillStyle = "#d35400";
                ctx.fillRect(ux, (uy + unitBoxSize + 2) + (3 * zoom), unitBoxSize * unit.strength, barHeight);
            });
        }


    

    });

    if (isBoxSelecting) {
        ctx.strokeStyle = "rgba(0, 255, 255, 0.8)";
        ctx.lineWidth = 2;
        ctx.fillStyle = "rgba(0, 255, 255, 0.1)";
        
        // Convert World back to Screen for drawing
        const x = (boxStartWorld.x + cameraX) * zoom;
        const y = (boxStartWorld.y + cameraY) * zoom;
        const w = (boxEndWorld.x - boxStartWorld.x) * zoom;
        const h = (boxEndWorld.y - boxStartWorld.y) * zoom;
        
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
    }

    // Highlight all selected divisions

    selectedDivisions.forEach(p => {
        let sX = (p.x * tileSize + cameraX) * zoom;
        let sY = (p.y * tileSize + cameraY) * zoom;
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2 * zoom;
        ctx.strokeRect(sX, sY, tileSize * zoom, tileSize * zoom);
    });



    provinces.forEach(p => {
        p.divisions.forEach(unit => {
            if (unit.targetX !== undefined) {
                // Check: Don't draw the head if the unit is already at the target tile
                if (p.x === unit.targetX && p.y === unit.targetY) return;
                const target = provinces.find(p => p.x === unit.targetX && p.y === unit.targetY);
                if(target.divisions.length > 0 && target.owner == p.owner) return;


                const startX = (p.x * tileSize + tileSize / 2 + cameraX) * zoom;
                const startY = (p.y * tileSize + tileSize / 2 + cameraY) * zoom;
                const endX = (unit.targetX * tileSize + tileSize / 2 + cameraX) * zoom;
                const endY = (unit.targetY * tileSize + tileSize / 2 + cameraY) * zoom;

                // Line
                ctx.beginPath();
                ctx.strokeStyle = "rgba(0, 211, 34, 0.7)";
                ctx.setLineDash([10 * zoom, 5 * zoom]);
                ctx.lineWidth = 2 * zoom;
                ctx.moveTo(startX, startY);
                ctx.lineTo(endX, endY);
                ctx.stroke();
                ctx.setLineDash([]); 

                // Head (Only draw if the line has length)
                const angle = Math.atan2(endY - startY, endX - startX);
                const headLen = 12 * zoom;

                ctx.beginPath();
                ctx.fillStyle = "rgba(0, 211, 34, 0.9)";
                ctx.moveTo(endX, endY);
                ctx.lineTo(
                    endX - headLen * Math.cos(angle - Math.PI / 6), 
                    endY - headLen * Math.sin(angle - Math.PI / 6)
                );
                ctx.lineTo(
                    endX - headLen * Math.cos(angle + Math.PI / 6), 
                    endY - headLen * Math.sin(angle + Math.PI / 6)
                );
                ctx.closePath(); 
                ctx.fill(); 
            }
        });
    });





    ctx.setTransform(1, 0, 0, 1, 0, 0); 

    // UI Background Bar
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(0, 0, canvas.width, 45);
    
    // UI items
    ctx.fillStyle = "white";
    ctx.font = "bold 18px monospace";
    ctx.fillText(`📅 ${gameDay}/${gameMonth}/${gameYear}`, 20, 28);
    ctx.fillText(`📦 SUPPLY: ${supply}`, 220, 28);
    ctx.fillText(`🎖 UNITS: ${selectedDivisions.length}`, 400, 28);
    ctx.fillText(`Speed: ${tickRate / 100}`, 600, 28);



};


function mainLoop() {
    draw();
    requestAnimationFrame(mainLoop);
}
mainLoop();

//#endregion









//#region EVENT LISTENERS
canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    const rect = canvas.getBoundingClientRect();

    const mouseWorldX = (e.clientX - rect.left) / zoom - cameraX;
    const mouseWorldY = (e.clientY - rect.top) / zoom - cameraY;

    if (e.shiftKey) {
        if(e.button === 0){
            // Start Box Selection
            isBoxSelecting = true;
            isDragging = false; // Disable panning
            boxStartWorld = { x: mouseWorldX, y: mouseWorldY };
            boxEndWorld = { x: mouseWorldX, y: mouseWorldY };
        } else if(e.button === 2){
            isDraggingArrow = true;
            const gridX = Math.floor(mouseWorldX / tileSize);
            const gridY = Math.floor(mouseWorldY / tileSize);
            currentPath = [{ x: gridX, y: gridY }];
        };
        if(selectedDivisions.length > 0){
            updateSidebar();
        } else {
            document.getElementById('selection-sidebar').style.visibility = "hidden";
        };
    } else {
        // Normal Panning
        isDragging = true;
        isBoxSelecting = false;
        startX = e.clientX;
        startY = e.clientY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }
});

window.addEventListener('mouseup', (e) => {
    if (e.target.closest('#selection-sidebar')) {
        isDragging = false;
        isBoxSelecting = false;
        return; 
    }
    isDragging = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const dragDistance = Math.sqrt(dx * dx + dy * dy);
    if(selectedDivisions.length > 0){
        updateSidebar();
    } else {
        document.getElementById('selection-sidebar').style.visibility = "hidden";
    };

    if (isBoxSelecting && e.button === 0) {
        // Calculate the box bounds
        const minX = Math.min(boxStartWorld.x, boxEndWorld.x) / tileSize;
        const maxX = Math.max(boxStartWorld.x, boxEndWorld.x) / tileSize;
        const minY = Math.min(boxStartWorld.y, boxEndWorld.y) / tileSize;
        const maxY = Math.max(boxStartWorld.y, boxEndWorld.y) / tileSize;

        // Select all divisions within the grid range
        selectedDivisions = provinces.filter(p => 
            p.x >= minX && p.x <= maxX && 
            p.y >= minY && p.y <= maxY && 
            p.divisions.length > 0 && p.owner === "Player"
        );
    }
    
    isDragging = false;
    isBoxSelecting = false;
    
    if(dragDistance < 10 && e.button === 0){

        selectedDivisions = []; 
        selectedProvince = null;
        const rect = canvas.getBoundingClientRect();
        const worldX = (e.clientX - rect.left) / zoom - cameraX;
        const worldY = (e.clientY - rect.top) / zoom - cameraY;

        const gridX = Math.floor(worldX / tileSize);
        const gridY = Math.floor(worldY / tileSize);

        // Find the clicked province
        const target = provinces.find(p => p.x === gridX && p.y === gridY);

        if (target) {
            if (target.divisions.length > 0 && target.owner === "Player") {
                selectedDivisions = [target];
            } else {
                selectedProvince = target; 
            }
        }

        if(selectedDivisions.length > 0){
            updateSidebar();
        } else {
            document.getElementById('selection-sidebar').style.visibility = "hidden";
        };

    };
    isDragging = false;

    if (isDraggingArrow && e.button === 2) {
        isDraggingArrow = false;
        
        // Assign the path to all selected divisions
        selectedDivisions.forEach(prov => {
            prov.divisions.forEach(unit => {
                // Give the unit a copy of the dragged path
                unit.queuedPath = [...currentPath]; 
                unit.isMoving = true;
            });
        });
        currentPath = []; // Clear visual path
    }

    if(selectedDivisions.length > 0){
        updateSidebar();
    } else {
        document.getElementById('selection-sidebar').style.visibility = "hidden";
    };
    isDragging = false;
    
});

window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const worldX = (e.clientX - rect.left) / zoom - cameraX;
    const worldY = (e.clientY - rect.top) / zoom - cameraY;

    if (isBoxSelecting) {
        boxEndWorld = { x: worldX, y: worldY };
    } else if (isDragging) {
        let dx = e.clientX - lastMouseX;
        let dy = e.clientY - lastMouseY;
        cameraX += dx / zoom; 
        cameraY += dy / zoom;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    } else if(isDraggingArrow){
        const gridX = Math.floor(worldX / tileSize);
        const gridY = Math.floor(worldY / tileSize);
        
        const lastTile = currentPath[currentPath.length - 1];
        if (gridX !== lastTile.x || gridY !== lastTile.y) {
            currentPath.push({ x: gridX, y: gridY });
        }
    };
});

function click(){

};

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const mouseWorldX = mouseX / zoom - cameraX;
    const mouseWorldY = mouseY / zoom - cameraY;
    const zoomIntensity = 0.001;
    const zoomFactor = Math.exp(-e.deltaY * zoomIntensity);
    const newZoom = Math.min(Math.max(0.1, zoom * zoomFactor), 5);
    cameraX = mouseX / newZoom - mouseWorldX;
    cameraY = mouseY / newZoom - mouseWorldY;
    zoom = newZoom;
}, { passive: false });


canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const gridX = Math.floor(((e.clientX - rect.left) / zoom - cameraX) / tileSize);
    const gridY = Math.floor(((e.clientY - rect.top) / zoom - cameraY) / tileSize);

    if (selectedDivisions.length === 0) return;

    selectedDivisions.forEach(p => {
        // Loop through all units in the province array
        p.divisions.forEach(unit => {
            if(selectedDivisions.length <= 3){
                unit.targetX = gridX;
                unit.targetY = gridY;
            };
        });
    });

    selectedDivisions = [];
});

let tabsOpen = false; 

window.addEventListener('keydown', (e) =>{
    e.preventDefault();

    if (e.key === "Escape") {
        
        isBoxSelecting = false;
        boxStartWorld = { x: 0, y: 0 };
        boxEndWorld = { x: 0, y: 0 };
        selectedDivisions = []; // Reset to empty array
        selectedProvince = null; // Clear the single selection too
        if(selectedDivisions.length > 0){
            updateSidebar();
        } else {
            document.getElementById('selection-sidebar').style.visibility = "hidden";
        };
    } else if(e.key === " "){
        if(isPaused){
            isPaused = false;
        } else{
            isPaused = true;
        };
    } else if(e.key === "="){
        if(tickRate < 500){
            tickRate += 100;
            setInterval(onTick, tickRate);
        };
    } else if(e.key === "Tab"){
        const tabsDialog = document.getElementById('tabs-dialog');
        if(tabsOpen){
            tabsDialog.close();
            tabsOpen = false;
        } else{
            tabsDialog.showModal();
            tabsOpen = true;
        };
    };

});

//#endregion

function moveUnit(fromProvince, toProvince, unitIndex){
    const unit = fromProvince.divisions[unitIndex];
    if (!unit) return;


    if(toProvince.divisions.length > 0 && fromProvince.owner == toProvince.owner){
        return;
    } else{

        if(toProvince.divisions.length === 0 && toProvince.owner !== fromProvince.owner){
            // Empty enemy province - just take it
            toProvince.divisions.push(unit);
            fromProvince.divisions.splice(unitIndex, 1);
            toProvince.owner = fromProvince.owner;
        } else if (toProvince.owner == fromProvince.owner) {
            // Friendly move
            toProvince.divisions.push(unit);
            fromProvince.divisions.splice(unitIndex, 1);
        }  else {
            // ACTUAL BATTLE
            const movingUnit = fromProvince.divisions[unitIndex]; 
            const stationaryDefender = toProvince.divisions[0]; // Get the first defender

            if (movingUnit && stationaryDefender) {
                battleCalculation(movingUnit, stationaryDefender, toProvince, fromProvince);
                movingUnit.isInBattle = true;
                stationaryDefender.isInBattle = true;
                
                // Freeze the attacker so they stay and fight
                movingUnit.targetX = undefined;
                movingUnit.targetY = undefined;
            } else {
                alert("Battle blocked: Attacker or Defender is missing.");
            }
        }
    };

    if (targetProv.divisions.length === 0) {
        // MOVE IN: The tile is clear
        executeMove(unit, targetProv);
    } else {
        // STOP; Someone is already there
        unit.targetX = unit.x; 
        unit.targetY = unit.y;
    }



}

function battleCalculation(attackerUnit, defenderUnit, location, fromProvince) {

    if (!attackerUnit || !defenderUnit) {
        alert("Combat Error! Atk: " + attackerUnit + " Def: " + defenderUnit);
        return; 
    }

    const atkKey = Object.keys(attackerUnit.composition)[0];
    const defKey = Object.keys(defenderUnit.composition)[0];
    
    const atkTemplate = unitTemplates[atkKey];
    const defTemplate = unitTemplates[defKey];

    let damage = (atkTemplate.softAttack * attackerUnit.strength) * 0.1;
    let defDamage = (defTemplate.softAttack * defenderUnit.strength) * 0.1;
    defDamage *= (defenderUnit.entrenchment + 1);

    // Push battle object logic
    battleCounter++;
    let newBattle = {
        id: "battle" + battleCounter,
        attackerUnit: attackerUnit, 
        defenderUnit: defenderUnit,
        location: location,
        fromProvince: fromProvince,
        attackerOrgDamage: damage,
        defenderOrgDamage: defDamage
    };

    battles.push(newBattle);
}

function callFreeDivision(targetProvince) {
    let closestUnitProv = null;
    let dynamicShortestDistance = Infinity;
    const leftOwner = provinces.find(p2 => p2.x == 0 && p2.y == 0).owner;
    const rightOwner = provinces.find(p2 => p2.x == 39 && p2.y == 39).owner;
    const upOwner = leftOwner;
    const downOwner = rightOwner;

    provinces.forEach(p => {
        // We check same Row, same Column, or
        //  if it's on a perfect diagonal (Math.abs diff is equal)
        const isSameRow = p.y === targetProvince.y;
        const isSameCol = p.x === targetProvince.x;
        const isDiagonal = Math.abs(p.x - targetProvince.x) === Math.abs(p.y - targetProvince.y);
        
        if ((isSameRow || isSameCol || isDiagonal) && 
            p.owner === targetProvince.owner && 
            p.divisions.length > 0) {
            if(p.frontLineStatus === false){
            
                // This treats diagonals as 1 step just like horizontal/vertical
                let dist = Math.max(Math.abs(p.x - targetProvince.x), Math.abs(p.y - targetProvince.y));
                
                if (dist < dynamicShortestDistance) {
                    // Only grab units that aren't already moving
                    if (p.divisions[0].targetX === undefined) {
                        dynamicShortestDistance = dist;
                        closestUnitProv = p;
                    }
                }
            }else if(p.maginotLineStatus == false){
                if(maginotDirection == vertical){
                    if(leftOwner == targetProvince.owner && p.x < targetProvince.x){
                        let dist = Math.max(Math.abs(p.x - targetProvince.x), Math.abs(p.y - targetProvince.y));
                    
                        if (dist < dynamicShortestDistance) {
                            // Only grab units that aren't already moving
                            if (p.divisions[0].targetX === undefined) {
                                dynamicShortestDistance = dist;
                                closestUnitProv = p;
                            }
                        }
                    } else if(targetProvince.owner == rightOwner && p.x > targetProvince.x){
                        let dist = Math.max(Math.abs(p.x - targetProvince.x), Math.abs(p.y - targetProvince.y));
                    
                        if (dist < dynamicShortestDistance) {
                            // Only grab units that aren't already moving
                            if (p.divisions[0].targetX === undefined) {
                                dynamicShortestDistance = dist;
                                closestUnitProv = p;
                            }
                        }
                    };
                }else if(maginotDirection == horizontal){
                    if(upOwner == targetProvince.owner && p.y < targetProvince.y){
                        let dist = Math.max(Math.abs(p.x - targetProvince.x), Math.abs(p.y - targetProvince.y));
                    
                        if (dist < dynamicShortestDistance) {
                            // Only grab units that aren't already moving
                            if (p.divisions[0].targetX === undefined) {
                                dynamicShortestDistance = dist;
                                closestUnitProv = p;
                            }
                        }
                    } else if(downOwner == targetProvince.owner && p.y > targetProvince.y ){
                        let dist = Math.max(Math.abs(p.x - targetProvince.x), Math.abs(p.y - targetProvince.y));
                    
                        if (dist < dynamicShortestDistance) {
                            // Only grab units that aren't already moving
                            if (p.divisions[0].targetX === undefined) {
                                dynamicShortestDistance = dist;
                                closestUnitProv = p;
                            }
                        }
                    };
                };
            };
        }
    });

    if (closestUnitProv) {
        let unit = closestUnitProv.divisions[0]; 
        unit.targetX = targetProvince.x;
        unit.targetY = targetProvince.y;
        console.log(`Strategic diagonal reinforcement called from ${closestUnitProv.x},${closestUnitProv.y}`);
    }
}



let currentMenu = "";
function changeMenu(menu){
    const buildingMenuButton = document.getElementById('buildingMenuButton');
    const productionMenuButton = document.getElementById('productionMenuButton');


    if(menu == "buildingMenu" && currentMenu != "buildingMenu"){
        buildingMenuButton.className = "toggled";
        currentMenu = "buildingMenu";
    } else{
        buildingMenuButton.className = "button";
    }
};

let maginotDirection = null;
const horizontal = "HORIZONTAL";
const vertical = "VERTICAL";
function updateMaginot(){
    
    provinces.forEach(p => p.maginotLineStatus = false); 

    let columns = [];

    

    //COLUMN SCAN
    for(let x = 0; x < gridWidth; x++){
        columnDensity = 0;
        let pCounter = 0;
        let eCounter = 0;
        let owner = null;
        

        for(let y = 0; y < gridHeight; y++){
            let currentProvince = provinces.find(p => p.x === x && p.y === y && p.frontLineStatus);
            if(currentProvince){
                if(currentProvince.divisions.length > 0){
                    columnDensity ++;
                    if(currentProvince.owner == "Player"){
                        pCounter ++;
                    } else if(currentProvince.owner == "Enemy"){
                        eCounter ++;
                    };
                };
            };
        };

        if(pCounter > eCounter){
            owner = "Player";
        } else if(eCounter > pCounter){
            owner = "Enemy"
        };

        columns.push({
            x: x,
            owner: owner,
            density: columnDensity
        });
    };

    columns = columns.sort((a, b) => b.density - a.density);
    columns = columns.slice(0, 2);

    //ROW SCAN

    let rows = [];

    //COLUMN SCAN
    for(let y = 0; y < gridHeight; y++){
        rowDensity = 0;
        let pCounter = 0;
        let eCounter = 0;
        let owner = null;

        for(let x = 0; x < gridWidth; x++){
            let currentProvince = provinces.find(p => p.x === x && p.y === y && p.frontLineStatus);
            if(currentProvince){
                if(currentProvince.divisions.length > 0){
                    rowDensity ++;
                    if(currentProvince.owner == "Player"){
                        pCounter ++;
                    } else if(currentProvince.owner == "Enemy"){
                        eCounter ++;
                    };
                };
            };
        };

        if(pCounter > eCounter){
            owner = "Player";
        } else if(eCounter > pCounter){
            owner = "Enemy";
        };

        rows.push({
            y: y,
            owner: owner,
            density: rowDensity
        });
    };

    rows = rows.sort((a, b) => b.density - a.density);
    rows = rows.slice(0, 2);

    calculateColumn = columns.reduce((sum, c) => sum + c.density, 0);
    calculateRow = rows.reduce((sum, c) => sum + c.density, 0);

    if (calculateColumn > calculateRow) {
        maginotDirection = vertical;
        columns.forEach(c => {
            for (let y = 0; y < gridHeight; y++) {

                // Search for the province by coordinates ONLY first
                let currentProvince = provinces.find(p => p.x === c.x && p.y === y);

                if (currentProvince && currentProvince.frontLineStatus && c.owner === currentProvince.owner) {
                    currentProvince.maginotLineStatus = true;
                }
            }
        });
    } else if (calculateRow > calculateColumn) {
        maginotDirection = horizontal;
        rows.forEach(c => {
            for (let x = 0; x < gridWidth; x++) {
                let currentProvince = provinces.find(p => p.x === x && p.y === c.y);

                if (currentProvince && currentProvince.frontLineStatus && c.owner === currentProvince.owner) {
                    currentProvince.maginotLineStatus = true;
                }
            }
        });
    }

    initializeFronts();
};

setInterval(updateMaginot, 1000);

let fronts = [];
function initializeFronts() {
    fronts = [];
    let assignedIds = new Set();

    retreatTracker = retreatTracker.filter(r => 
        provinces.some(p => p.divisions[0]?.id === r && p.frontLineStatus === true)
    );

    retreatTracker.forEach(r => {
        if (assignedIds.has(r)) return;

        const province = provinces.find(p => p.divisions[0]?.id === r);
        if (!province) return;

        let frontObject = {
            id: `Front_${fronts.length}`,
            units: [r],
            type: "Front"
        };
        assignedIds.add(r);

        province.neighbors.forEach(n => {
            let neighborUnit = n.divisions[0];
            if (neighborUnit && n.maginotLineStatus === false && !assignedIds.has(neighborUnit.id) && n.owner === province.owner) {
                
                frontObject.units.push(neighborUnit.id);
                assignedIds.add(neighborUnit.id);
                
                neighborUnit.frontID = frontObject.id;
            }
        });

        fronts.push(frontObject);
    });

    return fronts;
}

let focusedFront = false;

function initiateAiDefense(){
    
    const personalityPool = ["BERSERKER", "PREDATOR", "STRATEGIST"];
    let personality = personalityPool[Math.floor(Math.random() * personalityPool.length)];

    if(fronts.length <= 2 ){
        if(fronts.length == 1){
            focusedFront = fronts[0];
        } else{
            let totalOrg = 0;
            let totalStrength = 0;
            
            fronts[0].units.forEach(d => {
                totalOrg += d.currentOrg;
                totalStrength += d.strength;
            });

            let dynamicIndex1 = totalOrg/totalStrength;

            totalOrg = 0;
            totalStrength = 0;

            fronts[1].units.forEach(d => {
                totalOrg += d.currentOrg;
                totalStrength += d.strength;
            });
            
            let dynamicIndex2 = totalOrg/totalStrength;

            focusedFront = dynamicIndex1 > dynamicIndex2 ? fronts[0] : fronts[1];
        };
    } else{
        focusedFront = false;

        for(let i = 0; i < fronts.length; i++){

            personality = personalityPool[Math.floor(Math.random() * personalityPool.length)];
            if(personality == personalityPool[0]){
                try {
                let front = {...fronts[i]};

                // Map the ID to the Province, then grab the first division [0]
                let unitObjects = front.units.map(id => provinces.find(d => d.divisions[0]?.id === id)?.divisions[0]).filter(u => u);


                let strongestUnit = unitObjects.reduce((prev, current) => {
                    if (current.strength > prev.strength) return current;
                    if (prev.strength > current.strength) return prev;

                    const currentTile = provinces.find(p => p.divisions[0]?.id == current.id);

                    const currentNeighbors = currentTile.neighbors.filter(n => 
                        n.owner == currentTile.owner && n.divisions.length > 0
                    ).length;

                    prevTile = provinces.find(p => p.divisions[0]?.id == prev.id);
                    const prevNeighbors = prevTile.neighbors.filter(n => 
                        n.owner == prevTile.owner && n.divisions.length > 0
                    ).length;

                    return (currentNeighbors > prevNeighbors) ? current : prev;
                }, unitObjects[0]);

                let counterProvince = (strongestUnit && strongestUnit.id) 
                    ? provinces.find(p => p.divisions[0]?.id == strongestUnit.id) 
                    : null;
                if (!counterProvince) continue; 


                let counterAttack = provinces.find(p => p.divisions[0]?.id == strongestUnit.id).neighbors;
                counterAttack = counterAttack.filter(u => 
                    u.owner == "Enemy" && 
                    u.divisions.length > 0 && 
                    (!u.divisions[0].isInBattle || u.neighbors.includes(counterProvince))
                );


                counterAttack.sort((a, b) => {
                    let distA = Math.abs(a.x - counterProvince.x) + Math.abs(a.y - counterProvince.y);
                    let distB = Math.abs(b.x - counterProvince.x) + Math.abs(b.y - counterProvince.y);
                    return distA - distB;
                });

                counterAttack.forEach((c, index) => {
                    let unit = c.divisions[0];
                    if (!unit) return;

                    //If we gave an order less than 1 second ago, SKIP this unit
                    let currentTime = Date.now();
                    if (currentTime - unit.lastOrderTime < 10000) return; 

                    if (index == 0) {
                        if (!unit.isInBattle) {
                            unit.targetX = counterProvince.x;
                            unit.targetY = counterProvince.y;
                            unit.lastOrderTime = currentTime; // Lock it
                        }
                    } else {
                        if (!unit.isInBattle) {
                            unit.targetX = counterProvince.x;
                            unit.targetY = counterProvince.y;
                            unit.lastOrderTime = currentTime;

                            setTimeout(() => {
                                if (!unit.isInBattle) {
                                    unit.targetX = c.x;
                                    unit.targetY = c.y;
                                }
                            }, tickRate * 2); 
                        }
                    }
                });



                }catch(error){
                    alert(error + "\n\n" + error.stack);
                }

            } else if(personality == personalityPool[1]){
                // alert("personality 2");
            } else if(personality == personalityPool[2]){
                // alert("personality 3");
            } else{
                alert("This is not supposed to happen");
            };

        };

    };

    

    // if(personality == personalityPool[0]){
        
    // } else if(personality == personalityPool[1]){

    // } else if(personality == personalityPool[2]){

    // } else{
    //     alert("This is not supposed to happen");
    // };
};

setInterval(initiateAiDefense, 750);

function initiateAiAttack(){

};