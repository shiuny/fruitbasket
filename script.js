window.onerror = (msg, url, line, col, error) => {
    console.error("グローバルエラー発生:", { message: msg, url: url, line: line, column: col, error: error });
};

document.addEventListener('DOMContentLoaded', () => {

    // --- ゲーム設定 ---
    const BOARD_SIZE = 6;
    const HOLD_CELL = { row: 0, col: 0 };
    const JAMMER_MAN = { emoji: '👨', isJammer: true, state: 'roaming', level: 0, score: 0 };
    const FRUIT_PIECES = [
        { emoji: '🍒', score: 0, level: 1 }, { emoji: '🍊', score: 40, level: 2 },
        { emoji: '🍇', score: 200, level: 3 }, { emoji: '🍎', score: 500, level: 4 },
        { emoji: '🍑', score: 1500, level: 5 }, { emoji: '🍍', score: 5000, level: 6 },
        { emoji: '🍈', score: 10000, level: 7 }, { emoji: '🍉', score: 20000, level: 8 }
    ];
    const RICE_PIECES = [
        { emoji: '🍚', score: 5, level: 1, isJammer: true, state: 'captured' },
        { emoji: '🍙', score: 1000, level: 2 },
        { emoji: '🍱', score: 5000, level: 3 }
    ];
    const ITEMS = {
        sun: { name: 'sun', emoji: '☀️', effect: '合成おてつだい', isItem: true, level: 5, initialCount: 5 },
        bear: { name: 'bear', emoji: '🐻', effect: 'ピース消去', isItem: true, initialCount: 5 },
        cherry: { name: 'cherry', emoji: '🍒', effect: 'さくらんぼを置く', isItem: true, initialCount: 10, ...FRUIT_PIECES[0] },
        orange: { name: 'orange', emoji: '🍊', effect: 'みかんを置く', isItem: true, initialCount: 10, ...FRUIT_PIECES[1] },
        grape: { name: 'grape', emoji: '🍇', effect: 'ぶどうを置く', isItem: true, initialCount: 10, ...FRUIT_PIECES[2] }
    };
    const ALL_PIECES = [...FRUIT_PIECES, ...RICE_PIECES, JAMMER_MAN];

    // --- ゲーム状態変数 ---
    let board, currentScore, highScore, nextPiece, heldPiece, gameOver, lastPlaced, pendingPiece, activeItem, chainCount, itemCounts, isProcessing;
    let lastChainScore = 0;
    let normalBag = [];
    let rareBag = [];
    let hasRareBagChance = false;

    // --- DOM要素 ---
    const boardElement = document.querySelector('.board');
    const boardWrapperElement = document.querySelector('.board-wrapper');
    const currentScoreElement = document.getElementById('current-score');
    const highScoreElement = document.getElementById('high-score');
    const ruleModal = document.getElementById('rule-modal');
    const shopModal = document.getElementById('shop-modal');
    const gameOverModal = document.getElementById('game-over-modal');
    const finalScoreElement = document.getElementById('final-score');
    const itemListElement = document.getElementById('item-list');
    const hintAreaElement = document.getElementById('hint-area');
    const loadingElement = document.getElementById('loading');

    // --- 関数定義 ---
    const getFontSize = (level = 0) => {
        // CSSから動的にセルのサイズを取得
        const cellSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell-size')) || 60;
        // セルサイズに応じて基準となるフォントサイズを計算 (元の60pxセルで38pxだった比率を維持)
        const baseFontSize = cellSize * (38 / 60);
        return `${baseFontSize + 4 * level}px`;
    };

    const showChainEffect = (count) => {
        const boardWrapper = boardElement.parentElement;
        if (!boardWrapper) return;
        const chainDisplay = document.createElement('div');
        chainDisplay.className = 'chain-display show';
        chainDisplay.textContent = `${count} CHAIN!`;
        if (getComputedStyle(boardWrapper).position === 'static') {
            boardWrapper.style.position = 'relative';
        }
        boardWrapper.appendChild(chainDisplay);
        setTimeout(() => { if (chainDisplay.parentNode) chainDisplay.parentNode.removeChild(chainDisplay); }, 1000);
        boardElement.classList.add('chain-active');
        setTimeout(() => boardElement.classList.remove('chain-active'), 1000);
    };

    const applySuckInAnimation = (fromRow, fromCol, toRow, toCol) => {
        return new Promise(resolve => {
            const fromCell = document.querySelector(`.cell[data-row="${fromRow}"][data-col="${fromCol}"]`);
            const pieceSpan = fromCell?.querySelector('.piece');
            if (!pieceSpan) return resolve();

            // gapとセルの幅を動的に取得して移動距離を計算
            const boardGap = parseFloat(getComputedStyle(boardElement).gap);
            const deltaX = (toCol - fromCol) * (fromCell.offsetWidth + boardGap);
            const deltaY = (toRow - fromRow) * (fromCell.offsetHeight + boardGap);

            pieceSpan.style.setProperty('--tx', `${deltaX}px`);
            pieceSpan.style.setProperty('--ty', `${deltaY}px`);
            pieceSpan.classList.add('suck-in-animation');
            pieceSpan.addEventListener('animationend', () => { if (pieceSpan.parentNode) pieceSpan.parentNode.removeChild(pieceSpan); resolve(); }, { once: true });
        });
    };

    const applyMergeAnimation = (row, col) => {
        return new Promise(resolve => {
            const targetCell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
            const pieceSpan = targetCell?.querySelector('.piece');
            if (!targetCell || !pieceSpan) return resolve();
            pieceSpan.classList.add('merge-animation');
            targetCell.classList.add('merge-cell');
            for (let i = 0; i < 3; i++) {
                const particle = document.createElement('div');
                particle.className = 'particle';
                const angle = Math.random() * 360, distance = 15 + Math.random() * 10;
                particle.style.setProperty('--tx', `${Math.cos(angle * Math.PI / 180) * distance}px`);
                particle.style.setProperty('--ty', `${Math.sin(angle * Math.PI / 180) * distance}px`);
                targetCell.appendChild(particle);
                particle.addEventListener('animationend', () => { if (particle.parentNode) particle.parentNode.removeChild(particle); }, { once: true });
            }
            pieceSpan.addEventListener('animationend', () => {
                pieceSpan.classList.remove('merge-animation');
                targetCell.classList.remove('merge-cell');
                resolve();
            }, { once: true });
        });
    };

    const showScorePopup = (row, col, score, chain, multi = 1) => {
        const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        if (!cell) return;
        const popup = document.createElement('div');
        popup.className = 'score-popup';
        let text = `+${score}`;
        if (chain > 1) text += ` x${chain}Chain`;
        if (multi > 1) text += ` x${multi}Multi`;
        popup.textContent = text;
        cell.appendChild(popup);
        setTimeout(() => { if (popup.parentNode) popup.parentNode.removeChild(popup); }, 1000);
    };
    
    const animatePieceMove = (fromRow, fromCol, toRow, toCol, pieceData) => {
        return new Promise(resolve => {
            const fromCell = document.querySelector(`.cell[data-row="${fromRow}"][data-col="${fromCol}"]`);
            if (!fromCell) {
                resolve();
                return;
            }
    
            fromCell.style.zIndex = '10';
    
            const piece = document.createElement('span');
            piece.className = 'piece';
            piece.textContent = pieceData.emoji;
            piece.style.fontSize = getFontSize(pieceData.level);
            if (pieceData.emoji === JAMMER_MAN.emoji) {
                piece.style.transform = 'scale(1.2)';
            }
            fromCell.appendChild(piece);
    
            // gapとセルの幅を動的に取得して移動距離を計算
            const boardGap = parseFloat(getComputedStyle(boardElement).gap);
            const deltaX = (toCol - fromCol) * (fromCell.offsetWidth + boardGap);
            const deltaY = (toRow - fromRow) * (fromCell.offsetHeight + boardGap);
    
            requestAnimationFrame(() => {
                piece.style.transition = 'transform 0.3s ease-out';
                let scale = (pieceData.emoji === JAMMER_MAN.emoji) ? 'scale(1.2)' : '';
                piece.style.transform = `translate(${deltaX}px, ${deltaY}px) ${scale}`;
            });
    
            piece.addEventListener('transitionend', () => {
                fromCell.style.zIndex = '';
                
                if (piece.parentNode) {
                    piece.parentNode.removeChild(piece);
                }
                resolve();
            }, { once: true });
        });
    };

    const findConnectedGroup = (startRow, startCol, searchBoard) => {
        const pieceToMatch = searchBoard[startRow]?.[startCol];
        if (!pieceToMatch || pieceToMatch.isObstacle || pieceToMatch.state === 'roaming' || pieceToMatch.state === 'just_placed' || pieceToMatch.isItem) return [];
        const group = [];
        const queue = [[startRow, startCol]];
        const visited = new Set([`${startRow},${startCol}`]);
        while (queue.length > 0) {
            const [r, c] = queue.shift();
            group.push({ r, c });
            [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]].forEach(([nr, nc]) => {
                const key = `${nr},${nc}`;
                const neighbor = searchBoard[nr]?.[nc];
                if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && !visited.has(key) &&
                    neighbor && neighbor.emoji === pieceToMatch.emoji && !neighbor.isItem) {
                    visited.add(key);
                    queue.push([nr, nc]);
                }
            });
        }
        return group;
    };

    const calculateGroupScore = (evolvedPiece, simChainCount, simLastChainScore) => {
        const baseScore = evolvedPiece.score;
        const bonus = Math.floor(simLastChainScore * 1.2);
        const totalScore = baseScore + bonus;
        return { totalScore, newLastChainScore: totalScore };
    };

    const updateScore = () => {
        currentScoreElement.textContent = currentScore;
        if (currentScore > highScore) {
            highScore = currentScore;
            localStorage.setItem('highScore', highScore);
        }
        highScoreElement.textContent = highScore;
    };

    const getNextPiecePosition = () => {
        const pieceForPreview = activeItem || nextPiece;
        if (!pieceForPreview || gameOver) return null;
        const emptyCells = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (!board[r][c] && (r !== HOLD_CELL.row || c !== HOLD_CELL.col)) {
                    emptyCells.push({ row: r, col: c });
                }
            }
        }
        if (emptyCells.length === 0) return null;
        if (lastPlaced) {
            const { row, col } = lastPlaced;
            const neighbors = [{r:row-1,c:col}, {r:row,c:col-1}, {r:row+1,c:col}, {r:row,c:col+1}];
            for (const { r, c } of neighbors) {
                if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && !board[r][c] && (r !== HOLD_CELL.row || c !== HOLD_CELL.col)) {
                    return { row: r, col: c };
                }
            }
        }
        if (!pieceForPreview.isItem && pieceForPreview.emoji !== JAMMER_MAN.emoji) {
            for (const { row, col } of emptyCells) {
                const neighbors = [[row + 1, col], [row - 1, col], [row, col + 1], [row, col - 1]]
                    .filter(([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c]?.emoji === pieceForPreview.emoji);
                if (neighbors.length >= 2) return { row, col };
            }
        }
        if (!board[2][3] && (2 !== HOLD_CELL.row || 3 !== HOLD_CELL.col)) {
            return { row: 2, col: 3 };
        }
        return emptyCells[Math.floor(Math.random() * emptyCells.length)];
    };

    const renderBoard = () => {
        boardElement.innerHTML = '';
        if (activeItem || nextPiece?.isItem) {
            boardElement.classList.add('item-mode');
        } else {
            boardElement.classList.remove('item-mode');
        }
        const pieceToPreview = activeItem || nextPiece;
        const nextPiecePos = getNextPiecePosition();
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const cell = document.createElement('div');
                cell.className = `cell`;
                cell.dataset.row = r;
                cell.dataset.col = c;
                const pieceSpan = document.createElement('span');
                pieceSpan.className = 'piece';
                if (r === HOLD_CELL.row && c === HOLD_CELL.col) {
                    cell.classList.add('hold');
                    if (heldPiece) pieceSpan.textContent = heldPiece.emoji;
                } else if (board[r][c]) {
                    const piece = board[r][c];
                    if (piece.state !== 'roaming' && piece.state !== 'just_placed') {
                        cell.classList.add('occupied');
                    }
                    pieceSpan.textContent = piece.emoji;
                    pieceSpan.style.fontSize = getFontSize(piece.level);
                    if (piece.isObstacle) {
                        cell.classList.add('obstacle');
                    }
                    if (piece.emoji === JAMMER_MAN.emoji) {
                        pieceSpan.style.transform = 'scale(1.2)';
                    }
                } else if (pieceToPreview && nextPiecePos?.row === r && nextPiecePos?.col === c) {
                    pieceSpan.classList.add('pulse');
                    pieceSpan.textContent = pieceToPreview.emoji;
                    pieceSpan.style.fontSize = getFontSize(pieceToPreview.level || 0);
                    if (pieceToPreview.emoji === JAMMER_MAN.emoji) {
                        pieceSpan.style.transform = 'scale(1.2)';
                    }
                }
                cell.appendChild(pieceSpan);
                boardElement.appendChild(cell);
            }
        }
    };

    const refillBag = (bagType) => {
        let newBag = [];
        if (bagType === 'normal') {
            newBag = [
                {...FRUIT_PIECES[0]}, {...FRUIT_PIECES[0]}, {...FRUIT_PIECES[0]}, {...FRUIT_PIECES[0]}, {...FRUIT_PIECES[0]}, // 🍒 x5
                {...FRUIT_PIECES[1]}, {...FRUIT_PIECES[1]}, {...FRUIT_PIECES[1]}, // 🍊 x3
                {...FRUIT_PIECES[2]}, {...FRUIT_PIECES[2]},                      // 🍇 x2
                {...FRUIT_PIECES[3]},                                           // 🍎 x1
                {...JAMMER_MAN}, {...JAMMER_MAN},                                  // 👨 x2
                {...ITEMS.sun},                                                   // ☀️ x1
                {...ITEMS.bear}                                                   // 🐻 x1
            ];
        } else { // rare
            newBag = [
                {...FRUIT_PIECES[1]},
                {...FRUIT_PIECES[2]}, {...FRUIT_PIECES[2]},
                {...FRUIT_PIECES[3]},
                {...ITEMS.sun},
                {...ITEMS.bear} // 熊アイテムを追加
            ];
        }

        for (let i = newBag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newBag[i], newBag[j]] = [newBag[j], newBag[i]];
        }
        return newBag;
    };

    const generateNextPiece = () => {
        if (pendingPiece) {
            nextPiece = { ...pendingPiece };
            pendingPiece = null;
            return;
        }

        if (hasRareBagChance) {
            if (rareBag.length === 0) {
                rareBag = refillBag('rare');
            }
            nextPiece = rareBag.pop();
            hasRareBagChance = false;
        } else {
            if (normalBag.length === 0) {
                normalBag = refillBag('normal');
            }
            nextPiece = normalBag.pop();
        }

        if (!nextPiece || !nextPiece.emoji) {
            console.error("袋から無効なピースが取り出されました。");
            normalBag = refillBag('normal');
            nextPiece = normalBag.pop();
        }
    };

    const checkGameOver = () => {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (!board[r][c] && (r !== HOLD_CELL.row || c !== HOLD_CELL.col)) return;
            }
        }
        gameOver = true;
        finalScoreElement.textContent = currentScore;
        gameOverModal.style.display = 'flex';
    };

    const processAllMerges = async (animate = true, placement = null) => {
        let hasChainReaction;
        do {
            hasChainReaction = false;
            const tempBoard = JSON.parse(JSON.stringify(board));
            const mergesThisTurn = [];
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    if (tempBoard[r][c]) {
                        const group = findConnectedGroup(r, c, tempBoard);
                        if (group.length >= 3) {
                            const piece = tempBoard[r][c];
                            const pieceSet = RICE_PIECES.some(p => p.emoji === piece.emoji) ? RICE_PIECES : FRUIT_PIECES;
                            const isMaxLevel = pieceSet.findIndex(p => p.emoji === piece.emoji) === pieceSet.length - 1;
                            if (!isMaxLevel) {
                                mergesThisTurn.push({ group, piece, pieceSet });
                                group.forEach(({ r: gr, c: gc }) => tempBoard[gr][gc] = null);
                            }
                        }
                    }
                }
            }

            if (mergesThisTurn.length > 0) {
                hasChainReaction = true;
                chainCount++;
                if (animate && chainCount > 1) {
                    showChainEffect(chainCount);
                    hasRareBagChance = true;
                }

                const multiBonus = mergesThisTurn.length > 1 ? (1 + (mergesThisTurn.length -1) * 0.5) : 1;
                
                for (const { group, piece, pieceSet } of mergesThisTurn) {
                    const nextIndex = pieceSet.findIndex(p => p.emoji === piece.emoji) + 1;
                    const evolvedPiece = pieceSet[nextIndex];
                    let { totalScore: score } = calculateGroupScore(evolvedPiece, chainCount, lastChainScore);
                    score = Math.floor(score * multiBonus);
                    lastChainScore = score;
                    currentScore += score;

                    let target;
                    const lastPlacedInGroup = placement && group.find(({r, c}) => r === placement.row && c === placement.col);
                    if (lastPlacedInGroup) {
                        target = lastPlacedInGroup;
                    } else {
                        target = group.sort((a,b) => b.r - a.r || a.c - b.c)[0];
                    }
                    const { r: targetRow, c: targetCol } = target;
                    if (animate) {
                        const suckInPromises = group.filter(({ r, c }) => r !== targetRow || c !== targetCol).map(({ r, c }) => applySuckInAnimation(r, c, targetRow, targetCol));
                        await Promise.all(suckInPromises);
                    }
                    group.forEach(({ r, c }) => board[r][c] = null);
                    if (nextIndex < pieceSet.length) board[targetRow][targetCol] = { ...evolvedPiece };
                    if (animate) {
                        renderBoard();
                        showScorePopup(targetRow, targetCol, score, chainCount, mergesThisTurn.length);
                        if (board[targetRow][targetCol]) {
                            await applyMergeAnimation(targetRow, targetCol);
                        }
                    }
                }
                updateScore();
            }
        } while (hasChainReaction);
        if(!hasChainReaction) {
            chainCount = 0;
            lastChainScore = 0;
        }
    };

    const moveAndCaptureJammers = async (tempBlockedCells = new Set()) => {
        const allJammerPositions = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c]?.isJammer && board[r][c]?.state !== 'captured') {
                    allJammerPositions.push({ r, c });
                }
            }
        }
        if (allJammerPositions.length === 0) return;
    
        const jammersToCapture = [];
        const jammersToMove = [];
    
        for (const jammerPos of allJammerPositions) {
            const { r, c } = jammerPos;
            const queue = [[r, c]];
            const visited = new Set([`${r},${c}`]);
            let canEscape = false;
    
            while (queue.length > 0) {
                const [curR, curC] = queue.shift();
                for (const [nr, nc] of [[curR - 1, curC], [curR + 1, curC], [curR, curC - 1], [curR, curC + 1]]) {
                    const neighborKey = `${nr},${nc}`;
    
                    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || visited.has(neighborKey) || tempBlockedCells.has(neighborKey)) {
                        continue;
                    }
                    
                    const neighborPiece = board[nr][nc];
    
                    if (!neighborPiece && (nr !== HOLD_CELL.row || nc !== HOLD_CELL.col)) {
                        canEscape = true;
                        break;
                    }
    
                    if (neighborPiece?.state === 'roaming' || neighborPiece?.state === 'just_placed') {
                        visited.add(neighborKey);
                        queue.push([nr, nc]);
                    }
                }
                if (canEscape) break;
            }
    
            if (canEscape) {
                if (board[r][c]?.state === 'roaming') {
                    jammersToMove.push({ from: { r, c }, piece: board[r][c] });
                }
            } else {
                jammersToCapture.push({ r, c });
            }
        }
    
        jammersToCapture.forEach(({ r, c }) => {
            board[r][c] = { ...RICE_PIECES[0] };
        });
    
        if (jammersToMove.length > 0) {
            for (let i = jammersToMove.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [jammersToMove[i], jammersToMove[j]] = [jammersToMove[j], jammersToMove[i]];
            }
    
            const movePromises = [];
            const boardAfterMove = JSON.parse(JSON.stringify(board));
            const movedFromKeys = new Set();
    
            for (const jammer of jammersToMove) {
                const { r, c } = jammer.from;
                const availableMoves = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([nr, nc]) => {
                    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) return false;
                    if (nr === HOLD_CELL.row && nc === HOLD_CELL.col) return false;
                    if (tempBlockedCells.has(`${nr},${nc}`)) return false;
                    return !boardAfterMove[nr][nc];
                });
    
                if (availableMoves.length > 0) {
                    const [toR, toC] = availableMoves[Math.floor(Math.random() * availableMoves.length)];
                    boardAfterMove[r][c] = null;
                    boardAfterMove[toR][toC] = jammer.piece;
                    movePromises.push(animatePieceMove(r, c, toR, toC, jammer.piece));
                    movedFromKeys.add(`${r},${c}`);
                }
            }
            
            if (movePromises.length > 0) {
                movedFromKeys.forEach(key => {
                    const [r, c] = key.split(',').map(Number);
                    const cell = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
                    if (cell?.querySelector('.piece')) {
                        cell.querySelector('.piece').style.visibility = 'hidden';
                    }
                });
    
                board = boardAfterMove;
                await Promise.all(movePromises);
            }
        }
    };
    
    const _simulateMerges = (simBoard, placement) => {
        let totalScore = 0;
        let chainCount = 0;
        let lastChainScore = 0;
        let hasChainReaction;
        
        const tempBoard = JSON.parse(JSON.stringify(simBoard));
    
        do {
            hasChainReaction = false;
            const groupBoard = JSON.parse(JSON.stringify(tempBoard));
            const mergesThisTurn = [];
    
            for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                    if (groupBoard[r][c]) {
                        const group = findConnectedGroup(r, c, groupBoard);
                        if (group.length >= 3) {
                            const piece = groupBoard[r][c];
                            const pieceSet = RICE_PIECES.some(p => p.emoji === piece.emoji) ? RICE_PIECES : FRUIT_PIECES;
                            const isMaxLevel = pieceSet.findIndex(p => p.emoji === piece.emoji) === pieceSet.length - 1;
                            if (!isMaxLevel) {
                                mergesThisTurn.push({ group, piece, pieceSet });
                                group.forEach(({ r: gr, c: gc }) => groupBoard[gr][gc] = null);
                            }
                        }
                    }
                }
            }
    
            if (mergesThisTurn.length > 0) {
                hasChainReaction = true;
                chainCount++;
                const multiBonus = mergesThisTurn.length > 1 ? (1 + (mergesThisTurn.length -1) * 0.5) : 1;
                for (const { group, piece, pieceSet } of mergesThisTurn) {
                    const nextIndex = pieceSet.findIndex(p => p.emoji === piece.emoji) + 1;
                    const evolvedPiece = pieceSet[nextIndex];
                    
                    let { totalScore: score } = calculateGroupScore(evolvedPiece, chainCount, lastChainScore);
                    score = Math.floor(score * multiBonus);
                    totalScore += score;
                    lastChainScore = score;
                    
                    let target;
                    const lastPlacedInGroup = placement && group.find(({r, c}) => r === placement.row && c === placement.col);
                    if (lastPlacedInGroup) {
                        target = lastPlacedInGroup;
                    } else {
                        target = group.sort((a,b) => b.r - a.r || a.c - b.c)[0];
                    }
                    const { r: targetRow, c: targetCol } = target;
    
                    group.forEach(({ r, c }) => tempBoard[r][c] = null);
                    if (nextIndex < pieceSet.length) {
                        tempBoard[targetRow][targetCol] = { ...evolvedPiece };
                    }
                }
            }
        } while (hasChainReaction);
    
        return { score: totalScore, chains: chainCount };
    };

    const resolveSunItem = (row, col) => {
        const neighbors = [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]
            .filter(([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE 
                && board[r][c] && !board[r][c].isObstacle && board[r][c].state !== 'roaming' && board[r][c].state !== 'just_placed' && !board[r][c].isItem);
        let bestOption = null;
        
        const uniqueNeighborPieces = neighbors.reduce((acc, [nr, nc]) => {
            const piece = board[nr][nc];
            if (!acc.some(p => p.emoji === piece.emoji)) {
                acc.push(piece);
            }
            return acc;
        }, []);
        
        for (const pieceToCopy of uniqueNeighborPieces) {
            const tempBoard = JSON.parse(JSON.stringify(board));
            tempBoard[row][col] = { ...pieceToCopy, isItem: false };
            const group = findConnectedGroup(row, col, tempBoard);
            if (group.length >= 3) {
                const { score, chains } = _simulateMerges(tempBoard, { row, col });
                if (!bestOption || chains > bestOption.chains || (chains === bestOption.chains && score > bestOption.score)) {
                    bestOption = { piece: pieceToCopy, score: score, chains: chains };
                }
            }
        }
        if (bestOption) {
            return { ...bestOption.piece }; 
        } else {
            return { ...FRUIT_PIECES[0] }; 
        }
    };
    
    const handleHold = () => {
        const pieceToHold = activeItem || nextPiece;
        if (!pieceToHold) return;
        const previouslyHeld = heldPiece;
        heldPiece = pieceToHold;
        nextPiece = previouslyHeld;
        if (activeItem) {
            activeItem = null;
            if (!nextPiece && pendingPiece) {
                nextPiece = pendingPiece;
            }
            pendingPiece = null;
        }
        if (!nextPiece) {
            generateNextPiece();
        }
        renderBoard();
    };

    const resetItemSelection = () => {
        activeItem = null;
        if (pendingPiece) {
            nextPiece = pendingPiece;
            pendingPiece = null;
        } else if (!nextPiece) {
            generateNextPiece();
        }
    };
    
    const advanceTurn = async (placement) => {
        const pieceToPlace = { ...placement.piece, isItem: false };
        
        if (pieceToPlace.emoji === JAMMER_MAN.emoji) {
            pieceToPlace.state = 'just_placed';
        }
        board[placement.row][placement.col] = pieceToPlace;

        renderBoard(); 
        
        await processAllMerges(true, placement);
        await moveAndCaptureJammers();
        await processAllMerges(true, placement);
    };

    const activateNewJammers = () => {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c]?.state === 'just_placed') {
                    board[r][c].state = 'roaming';
                }
            }
        }
    };
    
    const handleCellClick = async (e) => {
        e.preventDefault();
        if (gameOver || isProcessing) return;
        const target = e.target.closest('.cell');
        if (!target) return;

        isProcessing = true;
        try {
            const row = parseInt(target.dataset.row);
            const col = parseInt(target.dataset.col);

            const pieceInHand = activeItem || nextPiece;
            if (!pieceInHand) {
                isProcessing = false;
                return;
            }

            if (row === HOLD_CELL.row && col === HOLD_CELL.col) {
                handleHold();
            } else {
                let turnIsValid = false;
                let finalPieceToPlace = pieceInHand;
                let actionType = 'place';

                if (pieceInHand.name === 'bear') {
                    if (board[row][col]) {
                        actionType = 'erase';
                        turnIsValid = true;
                    }
                } else if (!board[row][col]) {
                    if (pieceInHand.name === 'sun') {
                        finalPieceToPlace = resolveSunItem(row, col);
                    }
                    turnIsValid = true;
                }

                if (turnIsValid) {
                    const placement = { row, col, piece: finalPieceToPlace };

                    if (activeItem) {
                        itemCounts[activeItem.name]--;
                        resetItemSelection();
                    } else {
                        nextPiece = null;
                    }

                    if (actionType === 'erase') {
                        const targetPiece = board[row][col];
                        if (targetPiece.emoji === JAMMER_MAN.emoji) {
                            board[row][col] = { ...RICE_PIECES[0] };
                        } else {
                            board[row][col] = null;
                        }
                        renderBoard();
                        await moveAndCaptureJammers();
                        await processAllMerges(true, {row, col});
                    } else { 
                        await advanceTurn(placement);
                    }
                    
                    lastPlaced = { row, col };
                    activateNewJammers();
                    updateScore();
                    checkGameOver();
                    if (!gameOver && !nextPiece && !activeItem) {
                        generateNextPiece();
                    }
                }
            }
        } catch (error) {
            console.error("An error occurred during turn:", error);
        } finally {
            isProcessing = false;
            if (!gameOver) {
                renderBoard();
                if (shopModal.style.display === 'flex') {
                    updateItemShop();
                }
            }
        }
    };
    
    const updateItemShop = () => {
        itemListElement.innerHTML = '';
        Object.values(ITEMS).forEach(item => {
            const button = document.createElement('button');
            const count = itemCounts[item.name];
            button.textContent = `${item.emoji} ${item.effect} (のこり: ${count})`;
            button.disabled = count <= 0 || isProcessing;
            button.addEventListener('click', () => {
                if (count > 0 && !activeItem) {
                    if (nextPiece) {
                        pendingPiece = { ...nextPiece };
                    }
                    nextPiece = null;
                    activeItem = { ...item };
                    shopModal.style.display = 'none';
                    renderBoard();
                }
            });
            itemListElement.appendChild(button);
        });
    };

    const renderHints = () => {
        hintAreaElement.innerHTML = `<h3>進化のヒント</h3><p>くだもの: ${FRUIT_PIECES.map(p => p.emoji).join(' → ')}</p><p>おじゃま: 👨 → 🍚 → 🍙 → 🍱</p>`;
    };

    const initGame = async () => {
        loadingElement.style.display = 'flex';
        board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null));
        currentScore = 0;
        highScore = parseInt(localStorage.getItem('highScore') || '0');
        gameOver = false;
        nextPiece = null;
        heldPiece = null;
        lastPlaced = null;
        pendingPiece = null;
        activeItem = null;
        chainCount = 0;
        lastChainScore = 0;
        isProcessing = false;
        itemCounts = Object.keys(ITEMS).reduce((acc, key) => ({ ...acc, [key]: ITEMS[key].initialCount }), {});
        
        normalBag = [];
        rareBag = [];
        hasRareBagChance = false;

        updateScore();
        const availableCells = [];
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (r !== HOLD_CELL.row || c !== HOLD_CELL.col) {
                    availableCells.push({ r, c });
                }
            }
        }
        const initialPieces = [];
        initialPieces.push({ ...JAMMER_MAN });
        for (let i = 0; i < 7; i++) {
            initialPieces.push(Math.random() < 0.5 ? { ...FRUIT_PIECES[0] } : { ...FRUIT_PIECES[1] });
        }
        for (let i = initialPieces.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [initialPieces[i], initialPieces[j]] = [initialPieces[j], initialPieces[i]];
        }
        for(let i=0; i<8; i++){
             const idx = Math.floor(Math.random() * availableCells.length);
             const [{ r, c }] = availableCells.splice(idx, 1);
             board[r][c] = initialPieces[i];
        }
        await processAllMerges(false, null);
        generateNextPiece();
        renderBoard();
        renderHints();
        loadingElement.style.display = 'none';
    };

    const setupEventListeners = () => {
        boardElement.addEventListener('click', handleCellClick);
        boardElement.addEventListener('touchend', (e) => {
            if (isProcessing) return;
            handleCellClick(e);
        }, { passive: false });
        const closeModal = (modal) => {
            modal.style.display = 'none';
            if (activeItem) {
                resetItemSelection();
                renderBoard();
            }
        }
        const handleModalClick = (e) => {
            if (e.target.classList.contains('modal')) {
                closeModal(e.target);
            }
        };
        document.getElementById('rule-button').addEventListener('click', () => { ruleModal.style.display = 'flex'; });
        document.getElementById('shop-button').addEventListener('click', () => { updateItemShop(); shopModal.style.display = 'flex'; });
        document.getElementById('restart-button').addEventListener('click', initGame);
        document.getElementById('restart-button-modal').addEventListener('click', () => {
            closeModal(gameOverModal);
            initGame();
        });
        document.querySelectorAll('.close').forEach(btn => btn.addEventListener('click', (e) => { closeModal(e.target.closest('.modal')); }));
        [ruleModal, shopModal, gameOverModal].forEach(modal => modal.addEventListener('click', handleModalClick));
    };

    // --- ゲームの開始 ---
    setupEventListeners();
    initGame();
});