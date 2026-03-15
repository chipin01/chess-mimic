        let board = null;
        let game = new Chess();
        let treeData = {};
        let selectedGameId = null;
        let currentMoveIndex = -1; // -1 is start position
        let gameMoves = [];
        let gameEvals = [];
        const ARROW_COLOR = '#60a5fa';

        function onDrop(source, target) {
            let move = game.move({ from: source, to: target, promotion: 'q' });
            if (move === null) return 'snapback';
            // Force Visual Update
            board.position(game.fen(), false);

            // Sync move highlight
            const fen = game.fen();
            const moveIdx = gameMoves.findIndex(m => m.fen === fen);
            if (moveIdx !== -1) currentMoveIndex = moveIdx;

            updateUI();
            fetchAnalysis();
        }

        function playMove(san) {
            const move = game.move(san);
            if (!move) return;
            board.position(game.fen(), false);
            // Sync move index if within a loaded game
            const fen = game.fen();
            const moveIdx = gameMoves.findIndex(m => m.fen === fen);
            if (moveIdx !== -1) currentMoveIndex = moveIdx;
            updateUI();
            fetchAnalysis();
        }

        function toggleEngine() {
            if (!$('#engine-toggle').is(':checked')) {
                const svg = document.getElementById('arrow-svg');
                while (svg.firstChild) svg.removeChild(svg.firstChild);
            }
            fetchAnalysis();
        }

        function updateUI() {
            // Redraw chessboard if resized
            board.resize();

            const bh = $('#myBoard').height();
            if (bh > 0) $('#eval-bar-v').height(bh);

            updateTreeHighlight();

            // Update Highlight
            $('.move-btn').removeClass('active');
            if (currentMoveIndex !== -1) {
                $(`#move-btn-${currentMoveIndex}`).addClass('active');
            }

            if (selectedGameId) {
                $('#annotation-box').removeClass('hidden');
                const moveData = gameMoves[currentMoveIndex];
                $('#comment-input').val(moveData && moveData.comment ? moveData.comment : '');
            }
        }

        function drawArrow(move, color, opacity, index) {
            const from = move.substring(0, 2);
            const to = move.substring(2, 4);
            const boardEl = document.getElementById('myBoard');
            const rect = boardEl.getBoundingClientRect();
            const sqSize = rect.width / 8;
            const isFlipped = board.orientation() === 'black';
            const getCoords = (sq) => {
                let col = sq.charCodeAt(0) - 97;
                let row = 8 - parseInt(sq[1]);
                if (isFlipped) { col = 7 - col; row = 7 - row; }
                return { x: col * sqSize + sqSize / 2, y: row * sqSize + sqSize / 2 };
            };
            const f = getCoords(from), t = getCoords(to);
            const svg = document.getElementById('arrow-svg');
            svg.setAttribute('width', rect.width);
            svg.setAttribute('height', rect.height);
            svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
            const markerId = `arrowhead-${index}`;
            let defs = svg.querySelector('defs');
            if (!defs) { svg.appendChild(defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')); }
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', markerId); marker.setAttribute('markerWidth', '6'); marker.setAttribute('markerHeight', '6');
            marker.setAttribute('refX', '5'); marker.setAttribute('refY', '3'); marker.setAttribute('orient', 'auto');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M0,0 L0,6 L6,3 Z'); path.setAttribute('fill', color); path.setAttribute('fill-opacity', opacity);
            marker.appendChild(path); defs.appendChild(marker);
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', f.x); line.setAttribute('y1', f.y); line.setAttribute('x2', t.x); line.setAttribute('y2', t.y);

            // Dynamic arrow thickness: scaled with board width
            const strokeWidth = Math.max(2, rect.width * 0.012);
            line.setAttribute('stroke', color); line.setAttribute('stroke-width', strokeWidth); line.setAttribute('stroke-opacity', opacity);
            line.setAttribute('marker-end', `url(#${markerId})`);
            svg.appendChild(line);
        }

        function fetchAnalysis() {
            const svg = document.getElementById('arrow-svg');
            while (svg.firstChild) svg.removeChild(svg.firstChild);

            if (!$('#engine-toggle').is(':checked')) {
                $('#engine-status').text('Engine: Disabled');
                return;
            }

            $('#engine-status').text('Engine: Thinking...');
            $.get('/analyze?fen=' + encodeURIComponent(game.fen()), function (data) {
                if (!data) return;
                while (svg.firstChild) svg.removeChild(svg.firstChild);
                $('#engine-status').text('Engine: Ready');

                // 1. Tactical (Engine)
                const tactical = data.tactical;
                if (tactical && tactical.length > 0) {
                    const best = tactical[0];
                    $('#eval-text').text((best.score / 100).toFixed(1));
                    $('#eval-num').text(Math.abs(best.score / 100).toFixed(1));
                    const whiteHeight = Math.max(5, Math.min(95, 50 + (best.score / 10)));
                    $('#eval-white-v').css('height', whiteHeight + '%');
                    // Flip eval bar direction when board is flipped to black
                    const isBlack = board.orientation() === 'black';
                    $('#eval-bar-v').css('flex-direction', isBlack ? 'column' : 'column-reverse');

                    const $lines = $('#engine-lines').empty();
                    $lines.append(`<div class="text-[10px] font-bold text-gray-500 uppercase mb-1">Top Lines</div>`);
                    tactical.forEach((line, i) => {
                        const op = i === 0 ? 0.9 : (i === 1 ? 0.6 : 0.3);
                        drawArrow(line.best_move, ARROW_COLOR, op, i);
                        $lines.append(`<div class="bg-gray-750 p-2 rounded border text-xs mb-1" style="border-color: ${ARROW_COLOR}${Math.floor(op * 255).toString(16)}">
                            <div class="flex justify-between items-center">
                                <span style="color: ${ARROW_COLOR}" class="font-mono font-bold">${line.best_move}</span>
                                <span class="font-mono">${(line.score / 100).toFixed(1)}</span>
                            </div></div>`);
                    });
                }

                // 2. Positional Insights
                const positional = data.positional;
                const $insights = $('#engine-lines'); // Append to same tab for now
                if (positional && positional.length > 0) {
                    $insights.append(`<div class="text-[10px] font-bold text-gray-500 uppercase mt-4 mb-2">Positional Insights</div>`);
                    positional.forEach(p => {
                        const colorClass = p.severity === 'High' ? 'text-red-400' : (p.severity === 'Good' ? 'text-green-400' : 'text-yellow-400');
                        $insights.append(`<div class="bg-gray-900/50 p-2 rounded border border-gray-700 text-[10px] mb-1">
                            <div class="font-bold ${colorClass}">${p.type} (${p.square})</div>
                            <div class="text-gray-400 italic">${p.description}</div>
                        </div>`);
                    });
                }
            });
        }

        function showTab(tab) {
            $('.tab-content').addClass('hidden'); $(`#content-${tab}`).removeClass('hidden');
            $('.flex-1.py-3').removeClass('active-tab').addClass('text-gray-400');
            $(`#tab-${tab}`).addClass('active-tab').removeClass('text-gray-400');
        }

        function selectGame(id, callback) {
            selectedGameId = id;
            const player = $('#player-filter').val();
            $.get('/games/' + id, function (data) {
                gameMoves = data.moves;
                gameEvals = data.evals || [];
                $('#active-game-header').removeClass('hidden');
                $('#ag-players').text(`${data.white} vs ${data.black}`);
                $('#ag-meta').text(`${data.date} • ${data.result}`);
                if (player) {
                    if (data.white.toLowerCase().includes(player.toLowerCase())) board.orientation('white');
                    else if (data.black.toLowerCase().includes(player.toLowerCase())) board.orientation('black');
                }
                renderMoveList();
                showTab('moves');
                drawEvalChart(gameEvals, -1);
                if (callback) {
                    callback();
                } else {
                    jumpToMove(-1);
                }
            });
        }

        function renderMoveList() {
            const $mlist = $('#move-list').empty();
            let $row = null;
            gameMoves.forEach((m, i) => {
                if (i % 2 === 0) {
                    $mlist.append(`<div class="w-full text-[9px] text-gray-500 mt-3 mb-1 uppercase font-bold">Move ${Math.floor(i / 2) + 1}</div>`);
                    $row = $('<div class="flex w-full gap-2 mb-1"></div>').appendTo($mlist);
                }
                const hasComment = m.comment ? '<span class="comment-indicator">●</span>' : '';
                $row.append(`<button id="move-btn-${i}" onclick="jumpToMove(${i})" class="move-btn hover:bg-blue-600 px-2 py-1 rounded text-xs font-mono transition text-left">${m.san}${hasComment}</button>`);
                if (m.comment) {
                    $mlist.append(`<div class="comment-display italic">${m.comment}</div>`);
                }
            });
        }

        // --- Eval Chart ---
        function drawEvalChart(evals, highlightIdx) {
            if (!evals || !evals.length) {
                const wasVisible = !$('#eval-chart-wrap').hasClass('hidden');
                $('#eval-chart-wrap').addClass('hidden');
                if (wasVisible) { resizeBoardArea(); board.resize(); const bh = $('#myBoard').height(); if (bh > 0) $('#eval-bar-v').height(bh); }
                return;
            }
            const wasHidden = $('#eval-chart-wrap').hasClass('hidden');
            const $wrap = $('#eval-chart-wrap').removeClass('hidden');
            // If chart just became visible, re-compute board size to make room
            if (wasHidden) {
                resizeBoardArea();
                board.resize();
                const bh = $('#myBoard').height();
                if (bh > 0) $('#eval-bar-v').height(bh);
            }
            const canvas = document.getElementById('eval-chart');
            const w = $wrap.width();
            canvas.width = w;
            const h = canvas.height;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, w, h);

            // Clamp evals to [-1000, 1000] for display (±10 pawns)
            const maxEval = 1000;
            const clamped = evals.map(e => Math.max(-maxEval, Math.min(maxEval, e)));
            const mid = h / 2;

            // Background: top half white tinted, bottom half dark
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(0, 0, w, mid);
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            ctx.fillRect(0, mid, w, mid);

            const toY = (ev) => mid - (ev / maxEval) * mid;

            // Horizontal grid lines at ±1, ±3, ±5 pawns (100, 300, 500 cp)
            const gridLevels = [100, 300, 500, -100, -300, -500];
            ctx.setLineDash([2, 3]);
            ctx.lineWidth = 0.5;
            gridLevels.forEach(cp => {
                const gy = toY(cp);
                ctx.strokeStyle = 'rgba(255,255,255,0.08)';
                ctx.beginPath();
                ctx.moveTo(0, gy);
                ctx.lineTo(w, gy);
                ctx.stroke();
                // Label
                const label = (cp > 0 ? '+' : '') + (cp / 100);
                ctx.fillStyle = 'rgba(255,255,255,0.2)';
                ctx.font = '8px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(label, 3, gy - 2);
            });
            ctx.setLineDash([]);

            // Zero line (bolder)
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, mid);
            ctx.lineTo(w, mid);
            ctx.stroke();
            ctx.setLineDash([]);
            // Zero label
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('0', 3, mid - 3);

            // Fill area under/above the eval line
            const step = w / Math.max(clamped.length - 1, 1);

            // Filled area (white = positive, dark = negative)
            ctx.beginPath();
            ctx.moveTo(0, mid);
            for (let i = 0; i < clamped.length; i++) {
                ctx.lineTo(i * step, toY(clamped[i]));
            }
            ctx.lineTo((clamped.length - 1) * step, mid);
            ctx.closePath();
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, 'rgba(255,255,255,0.35)');
            grad.addColorStop(0.5, 'rgba(255,255,255,0.05)');
            grad.addColorStop(0.5, 'rgba(0,0,0,0.05)');
            grad.addColorStop(1, 'rgba(50,50,50,0.35)');
            ctx.fillStyle = grad;
            ctx.fill();

            // Main eval line
            ctx.beginPath();
            for (let i = 0; i < clamped.length; i++) {
                const x = i * step, y = toY(clamped[i]);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(200,200,200,0.7)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Highlight current move indicator
            if (typeof highlightIdx === 'number' && highlightIdx >= 0 && highlightIdx < clamped.length) {
                const hx = highlightIdx * step;
                ctx.strokeStyle = 'rgba(239,68,68,0.8)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(hx, 0);
                ctx.lineTo(hx, h);
                ctx.stroke();
                // Dot on the eval point
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(hx, toY(clamped[highlightIdx]), 3.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        function updateChartIndicator() {
            drawEvalChart(gameEvals, currentMoveIndex);
        }

        // Click on chart -> jump to that move
        $('#eval-chart').on('click', function (e) {
            if (!gameEvals.length || !gameMoves.length) return;
            const rect = this.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const ratio = x / rect.width;
            const idx = Math.round(ratio * (gameEvals.length - 1));
            jumpToMove(Math.max(0, Math.min(idx, gameMoves.length - 1)));
        });

        function jumpToMove(idx) {
            currentMoveIndex = idx;
            if (idx === -1) {
                game.reset();
            } else {
                const safeIdx = Math.max(-1, Math.min(idx, gameMoves.length - 1));
                currentMoveIndex = safeIdx;
                if (safeIdx === -1) {
                    game.reset();
                } else {
                    game.load(gameMoves[safeIdx].fen);
                }
            }
            board.position(game.fen(), false);
            updateUI();
            fetchAnalysis();
            updateChartIndicator();
        }

        function jumpToFen(fen) {
            $('#engine-toggle').prop('checked', false);
            game.load(fen);
            board.orientation(game.turn() === 'w' ? 'white' : 'black');
            board.position(fen, false);
            const moveIdx = gameMoves.findIndex(m => m.fen === fen);
            currentMoveIndex = moveIdx;
            updateUI();
            fetchAnalysis();
        }

        function findPuzzles() {
            if (!selectedGameId) return alert("Select a game first!");
            $('#puzzle-list').html('<div class="text-xs text-blue-400 italic animate-pulse text-center">Scanning...</div>');
            $.get(`/games/${selectedGameId}/puzzles`, function (puzzles) {
                const $list = $('#puzzle-list').empty();
                if (puzzles.length === 0) {
                    $list.html('<div class="text-gray-500 text-xs text-center">No major blunders found.</div>');
                    return;
                }
                puzzles.forEach((p, i) => {
                    const diff = Math.abs(p.score_before - p.score_after) / 100;
                    const side = p.turn === 'white' ? 'White' : 'Black';
                    $list.append(`<div class="bg-gray-750 p-3 rounded border border-red-900/30 hover:border-red-500 cursor-pointer transition" onclick="jumpToPuzzle('${p.fen}')">
                        <div class="flex justify-between items-center">
                            <span class="text-xs font-bold text-red-400">Blunder by ${side} (Move ${p.move_number})</span>
                            <span class="text-[10px] text-gray-500">-${diff.toFixed(1)}</span>
                        </div>
                        <div class="text-[10px] text-gray-400 mt-1">Find a better move for ${side}</div>
                    </div>`);
                });
            });
        }

        function jumpToPuzzle(fen) {
            // Jump directly to the position before the blunder
            jumpToFen(fen);
        }

        function saveAnnotation() {
            if (!selectedGameId || currentMoveIndex === -1) return;
            const comment = $('#comment-input').val();
            const fen = game.fen();
            $.ajax({
                url: `/games/${selectedGameId}/annotate`,
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ fen: fen, comment: comment }),
                success: function () {
                    const m = gameMoves[currentMoveIndex];
                    if (m) m.comment = comment;
                    renderMoveList();
                    updateUI();
                    alert('Note saved!');
                }
            });
        }

        // Cached data for search filtering
        let _cachedFolders = [];
        let _cachedGames = [];
        let _selectedTreeGames = new Set();  // checkbox staging
        let _treeGames = new Set();          // committed to tree

        let _treeSide = 'white'; // 'white' or 'black'

        function populateTreePlayerDropdowns() {
            const $whiteList = $('#tree-white-list');
            const $blackList = $('#tree-black-list');
            const selectedWhite = new Set($('.white-player-checkbox:checked').map((_, el) => el.value).get());
            const selectedBlack = new Set($('.black-player-checkbox:checked').map((_, el) => el.value).get());

            // Collect unique players from games currently in the tree
            const whitePlayers = new Set();
            const blackPlayers = new Set();
            _cachedGames.forEach(g => {
                if (!_treeGames.has(g.id)) return;
                if (g.white && g.white !== '?' && g.white !== 'Unknown') whitePlayers.add(g.white);
                if (g.black && g.black !== '?' && g.black !== 'Unknown') blackPlayers.add(g.black);
            });

            // Rebuild lists
            $whiteList.empty();
            $blackList.empty();
            [...whitePlayers].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).forEach(p => {
                const checked = selectedWhite.has(p) ? 'checked' : '';
                $whiteList.append(`
                    <label class="flex items-center gap-2 p-1 hover:bg-gray-700 rounded cursor-pointer text-[10px]">
                        <input type="checkbox" value="${p}" class="white-player-checkbox" ${checked} onchange="onTreePlayerChange(event)"> <span>${p}</span>
                    </label>
                `);
            });
            [...blackPlayers].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).forEach(p => {
                const checked = selectedBlack.has(p) ? 'checked' : '';
                $blackList.append(`
                    <label class="flex items-center gap-2 p-1 hover:bg-gray-700 rounded cursor-pointer text-[10px]">
                        <input type="checkbox" value="${p}" class="black-player-checkbox" ${checked} onchange="onTreePlayerChange(event)"> <span>${p}</span>
                    </label>
                `);
            });

            updatePlayerSelectButtons();
        }

        function updatePlayerSelectButtons() {
            const selectedWhite = $('.white-player-checkbox:checked').map((_, el) => el.value).get().filter(v => v !== '');
            const selectedBlack = $('.black-player-checkbox:checked').map((_, el) => el.value).get().filter(v => v !== '');

            $('#tree-white-player-dropdown button').text(selectedWhite.length === 0 ? 'Any player' : (selectedWhite.length === 1 ? selectedWhite[0] : selectedWhite.length + ' players'));
            $('#tree-black-player-dropdown button').text(selectedBlack.length === 0 ? 'Any player' : (selectedBlack.length === 1 ? selectedBlack[0] : selectedBlack.length + ' players'));
        }

        function onTreePlayerChange(event) {
            // Handle "Any player" checkbox logic
            if ($(event.target).val() === "") {
                const isChecked = $(event.target).prop('checked');
                const listClass = $(event.target).hasClass('white-player-checkbox') ? '.white-player-checkbox' : '.black-player-checkbox';
                if (isChecked) {
                    $(listClass).prop('checked', false);
                    $(event.target).prop('checked', true);
                }
            } else {
                const listClass = $(event.target).hasClass('white-player-checkbox') ? '.white-player-checkbox' : '.black-player-checkbox';
                if ($(event.target).prop('checked')) {
                    $(`${listClass}[value=""]`).prop('checked', false);
                }
            }

            updatePlayerSelectButtons();

            // Auto-infer _treeSide
            const whitePlayers = $('.white-player-checkbox:checked').map((_, el) => el.value).get().filter(v => v !== '');
            const blackPlayers = $('.black-player-checkbox:checked').map((_, el) => el.value).get().filter(v => v !== '');

            if (whitePlayers.length > 0 && blackPlayers.length === 0) _treeSide = 'white';
            else if (blackPlayers.length > 0 && whitePlayers.length === 0) _treeSide = 'black';
            else _treeSide = 'white';

            loadTree();
        }

        function getFenKey(fen) {
            return fen.split(' ').slice(0, 3).join(' ');
        }

        const TREE_INITIAL_DEPTH = 4; // Only eagerly render this many levels; rest is lazy-loaded on click

        function buildTreeView() {
            const $view = $('#tree-view').empty();
            if (!treeData || Object.keys(treeData).length === 0) {
                $view.html('<div class="text-[10px] text-gray-500 italic py-4 text-center">No tree data</div>');
                return;
            }
            // Get the current board move path for auto-expanding
            const boardHistory = game.history();
            const tempGame = new Chess();
            const startFen = getFenKey(tempGame.fen());
            renderTreeBranch($view, tempGame, startFen, 0, 200, [], boardHistory);
        }

        function renderTreeBranch($container, parentGame, fenKey, depth, maxDepth, movePath, boardHistory) {
            if (depth >= maxDepth) return;
            const moves = treeData[fenKey];
            if (!moves) return;

            const flipWinLoss = (_treeSide === 'black');
            const currentFenKey = getFenKey(game.fen());

            const sorted = Object.keys(moves).sort((a, b) => moves[b].count - moves[a].count);

            sorted.forEach((san, idx) => {
                const s = moves[san];
                const turn = fenKey.split(' ')[1];
                const isPlayerTurn = (_treeSide === 'white' && turn === 'w') || (_treeSide === 'black' && turn === 'b');

                // Follow the linear chain: collect consecutive single-continuation moves
                const lineSpans = [];
                let curGame = new Chess(parentGame.fen());
                let curFen = fenKey;
                let curSan = san;
                let curStats = s;
                let curDepth = depth;
                let curPath = movePath.slice();
                let endFen = null;
                let endGame = null;

                while (true) {
                    const curTurn = curFen.split(' ')[1];
                    const moveClass = curTurn === 'w' ? 'white-move' : 'black-move';
                    const ply = curDepth + 1;
                    const moveNum = Math.ceil(ply / 2);
                    const moveLabel = curTurn === 'w' ? `${moveNum}.` : `${moveNum}...`;

                    const result = curGame.move(curSan);
                    if (!result) break;
                    curPath = curPath.concat(curSan);
                    const pathKey = curPath.join(',');
                    endFen = getFenKey(curGame.fen());
                    endGame = new Chess(curGame.fen());
                    curDepth++;

                    lineSpans.push({
                        turn: curTurn,
                        san: curSan,
                        moveNum: moveNum,
                        moveClass: moveClass,
                        pathKey: pathKey,
                        fen: endFen,
                        html: `<span class="inline-move" onclick="event.stopPropagation(); playTreePath('${pathKey}')" title="${curSan}"><span class="text-gray-500 text-[9px]">${moveLabel}</span><span class="move-san ${moveClass}">${curSan}</span></span>`
                    });

                    // Check if the resulting position has exactly one continuation
                    const nextMoves = treeData[endFen];
                    if (!nextMoves) break; // dead end
                    const nextSans = Object.keys(nextMoves);
                    if (nextSans.length !== 1) break; // branch point — stop inlining

                    // Continue the linear chain
                    curSan = nextSans[0];
                    curStats = nextMoves[curSan];
                    curFen = endFen;
                }

                // Use stats from the last move in the chain for display
                const finalStats = curStats;
                const winVal = flipWinLoss ? finalStats.loss : finalStats.win;
                const lossVal = flipWinLoss ? finalStats.win : finalStats.loss;
                const wr = ((winVal / finalStats.count) * 100).toFixed(1);
                const dr = ((finalStats.draw / finalStats.count) * 100).toFixed(0);
                const lr = ((lossVal / finalStats.count) * 100).toFixed(0);

                // Eval from last move
                let evalHtml = '';
                if (finalStats.avg_eval !== null && finalStats.avg_eval !== undefined) {
                    const evalPawns = finalStats.avg_eval / 100;
                    const displayEval = flipWinLoss ? -evalPawns : evalPawns;
                    const sign = displayEval > 0 ? '+' : '';
                    const evalColor = displayEval > 0.3 ? '#4ade80' : (displayEval < -0.3 ? '#f87171' : '#9ca3af');
                    evalHtml = `<span class="text-[9px] font-mono ml-1 flex-shrink-0" style="color:${evalColor}; min-width:32px; text-align:right">${sign}${displayEval.toFixed(1)}</span>`;
                }

                const finalPathKey = curPath.join(',');
                const hasChildren = endFen && !!treeData[endFen];
                const isOnPath = endFen && currentFenKey === endFen;

                // Check if this path includes the board history
                const isOnBoardPath = boardHistory && depth < boardHistory.length && boardHistory[depth] === san;

                const isSingleGame = s.count === 1;
                const withinInitialDepth = depth < TREE_INITIAL_DEPTH;
                const autoExpand = withinInitialDepth && !isSingleGame && (isOnBoardPath || !isPlayerTurn || idx === 0 || depth < 2);

                // Build the continuation indicator for linear chains
                const hasLinearContinuation = lineSpans.length > 1;
                const lineId = `line-${depth}-${idx}-${Date.now()}`;
                const continuationHtml = hasLinearContinuation
                    ? `<span class="line-expand-btn" onclick="event.stopPropagation(); $(this).closest('.tree-node-header').find('.chevron').trigger('click')" title="${lineSpans.length - 1} more moves">${hasChildren ? '▾' : '…+' + (lineSpans.length - 1)}</span>`
                    : '';

                const $node = $(`<div class="tree-node" data-path="${finalPathKey}" data-fen="${endFen || ''}"></div>`);
                const $header = $(`
                    <div class="tree-node-header ${isOnPath ? 'active-path' : ''}" onclick="playTreePath('${finalPathKey}')" title="${s.count} games, ${wr}% win">
                        <span class="chevron">${hasChildren ? (autoExpand ? '▾' : '▸') : '·'}</span>
                        ${lineSpans[0].html}
                        ${continuationHtml}
                        <span class="move-count">${s.count}</span>
                        <span class="win-bar"><span class="wb" style="width:${wr}%"></span><span class="db" style="width:${dr}%"></span><span class="lb" style="width:${lr}%"></span></span>
                        <span class="text-[9px] flex-shrink-0 ${parseFloat(wr) >= 50 ? 'text-green-400' : 'text-red-400'}" style="min-width:28px; text-align:right">${wr}%</span>
                        ${evalHtml}
                    </div>
                `);

                // Add vertical continuation list below the header
                if (hasLinearContinuation) {
                    const lineStartHidden = !hasChildren;
                    const $lineList = $(`<div id="${lineId}" class="${lineStartHidden ? 'hidden' : ''} linear-continuation"></div>`);
                    const $grid = $(`<div class="linear-grid"></div>`);
                    // Build paired rows: move#, white, black
                    for (let li = 1; li < lineSpans.length; li++) {
                        const span = lineSpans[li];
                        if (span.turn === 'w') {
                            const num = span.moveNum;
                            const whiteCell = `<span class="linear-cell inline-move" data-fen="${span.fen}" onclick="event.stopPropagation(); playTreePath('${span.pathKey}')"><span class="move-san ${span.moveClass}">${span.san}</span></span>`;
                            const nextSpan = (li + 1 < lineSpans.length && lineSpans[li + 1].turn === 'b') ? lineSpans[li + 1] : null;
                            const blackCell = nextSpan
                                ? `<span class="linear-cell inline-move" data-fen="${nextSpan.fen}" onclick="event.stopPropagation(); playTreePath('${nextSpan.pathKey}')"><span class="move-san ${nextSpan.moveClass}">${nextSpan.san}</span></span>`
                                : `<span class="linear-cell"></span>`;
                            if (nextSpan) li++;
                            $grid.append(`<span class="linear-num">${num}.</span>${whiteCell}${blackCell}`);
                        } else {
                            // Black move without preceding white
                            const num = span.moveNum;
                            $grid.append(`<span class="linear-num">${num}.</span><span class="linear-cell"></span><span class="linear-cell inline-move" data-fen="${span.fen}" onclick="event.stopPropagation(); playTreePath('${span.pathKey}')"><span class="move-san ${span.moveClass}">${span.san}</span></span>`);
                        }
                    }
                    $lineList.append($grid);
                    $node.append($header);
                    $node.append($lineList);
                } else {
                    $node.append($header);
                }

                // Determine if this node has expandable content (continuation or children)
                const hasExpandable = hasLinearContinuation || hasChildren;

                const $children = $(`<div class="tree-node-children ${autoExpand ? '' : 'collapsed'}"></div>`);

                // Sync linear continuation with expand state
                if (hasLinearContinuation && !autoExpand) {
                    // Both start collapsed together
                    $node.find('> .linear-continuation').addClass('hidden');
                }

                // Toggle expand/collapse on chevron — controls BOTH continuation and children as one unit
                $header.find('.chevron').on('click', function (e) {
                    e.stopPropagation();
                    const $cont = $node.find('> .linear-continuation');
                    const $ch = $node.find('> .tree-node-children');
                    const isCollapsed = $ch.hasClass('collapsed');
                    if (isCollapsed) {
                        // Expand both
                        $cont.removeClass('hidden');
                        $ch.removeClass('collapsed');
                        $(this).text('▾');
                        // Also update the line-expand-btn if present
                        $header.find('.line-expand-btn').text('▾');
                    } else {
                        // Collapse both
                        $cont.addClass('hidden');
                        $ch.addClass('collapsed');
                        $(this).text('▸');
                        $header.find('.line-expand-btn').text('…+' + (lineSpans.length - 1));
                    }
                    // Lazy-load children if not yet rendered
                    if (!$ch.hasClass('collapsed') && $ch.children().length === 0 && hasChildren) {
                        renderTreeBranch($ch, endGame, endFen, curDepth, maxDepth, curPath, boardHistory);
                    }
                });


                if (hasChildren) {
                    if (autoExpand) {
                        renderTreeBranch($children, endGame, endFen, curDepth, maxDepth, curPath, boardHistory);
                    }
                    $node.append($children);
                }

                $container.append($node);
            });
        }

        function updateTreeHighlight() {
            // Remove old highlights
            $('.tree-node-header.active-path').removeClass('active-path');
            $('.linear-cell.active-cell').removeClass('active-cell');
            // Find the tree node matching current board FEN and highlight it
            const currentFenKey = getFenKey(game.fen());
            $(`.tree-node[data-fen="${currentFenKey}"]`).each(function () {
                const $header = $(this).children('.tree-node-header');
                $header.addClass('active-path');
                // Make sure all ancestor nodes are expanded
                $(this).parents('.tree-node-children.collapsed').each(function () {
                    $(this).removeClass('collapsed');
                    $(this).siblings('.tree-node-header').find('.chevron').text('▾');
                });
            });
            // Also highlight linear continuation cells
            $(`.linear-cell[data-fen="${currentFenKey}"]`).each(function () {
                $(this).addClass('active-cell');
                // Auto-expand the linear continuation if it's hidden
                const $cont = $(this).closest('.linear-continuation');
                if ($cont.hasClass('hidden')) {
                    $cont.removeClass('hidden');
                    $cont.siblings('.tree-node-header').find('.line-expand-btn').text('▾');
                }
            });
        }

        function playTreePath(pathKey) {
            const moves = pathKey.split(',');
            game = new Chess();
            for (const san of moves) {
                if (!game.move(san)) break;
            }
            board.position(game.fen(), false);
            // Sync with loaded game if applicable
            const fen = game.fen();
            const moveIdx = gameMoves.findIndex(m => m.fen === fen);
            if (moveIdx !== -1) currentMoveIndex = moveIdx;
            updateUI();
            fetchAnalysis();
        }

        function loadTree() {
            const allIds = Array.from(_treeGames);
            const $info = $('#tree-info-text');
            if (allIds.length === 0) {
                treeData = {};
                $info.html('<span class="text-gray-500 italic">Select games in the Games tab to build tree</span>');
                buildTreeView();
                return;
            }

            // Filter by player checkboxes
            const selectedWhite = new Set($('.white-player-checkbox:checked').map((_, el) => el.value).get().filter(v => v !== ''));
            const selectedBlack = new Set($('.black-player-checkbox:checked').map((_, el) => el.value).get().filter(v => v !== ''));

            const filteredIds = allIds.filter(id => {
                const g = _cachedGames.find(g => g.id === id);
                if (!g) return true;
                if (selectedWhite.size > 0 && !selectedWhite.has(g.white)) return false;
                if (selectedBlack.size > 0 && !selectedBlack.has(g.black)) return false;
                return true;
            });

            if (filteredIds.length === 0) {
                treeData = {};
                const totalN = allIds.length;
                $info.html(`<span class="text-yellow-400 text-[10px]">No games match filters</span> · <a href="#" onclick="showTreeGamesInTab(); return false;" class="text-blue-400 hover:text-blue-300 underline font-medium not-italic text-[10px]">${totalN} in tree</a>`);
                buildTreeView();
                return;
            }

            const n = filteredIds.length;
            const totalN = allIds.length;
            const filterNote = (selectedWhite.size > 0 || selectedBlack.size > 0) ? ` of ${totalN}` : '';
            $info.html(`Based on <a href="#" onclick="showTreeGamesInTab(); return false;" class="text-blue-400 hover:text-blue-300 underline font-medium not-italic">${n}${filterNote} game${n !== 1 ? 's' : ''}</a>`);
            $.get('/tree?game_ids=' + filteredIds.join(','), data => { treeData = data; buildTreeView(); });
        }

        function showTreeGamesInTab() {
            showTab('games');
            // Set search to a special filter token so only tree games are visible
            $('#game-search').val('::tree');
            $('#game-search-clear').removeClass('hidden');
            renderGameList();
        }

        function toggleTreeGame(gameId) {
            if (_selectedTreeGames.has(gameId)) {
                _selectedTreeGames.delete(gameId);
            } else {
                _selectedTreeGames.add(gameId);
            }
            updateSelectionCount();
        }

        function addToTree() {
            if (_selectedTreeGames.size === 0) return;
            _selectedTreeGames.forEach(id => _treeGames.add(id));
            _selectedTreeGames.clear();
            $('.tree-checkbox').prop('checked', false);
            updateSelectionCount();
            renderGameList();
            populateTreePlayerDropdowns();
            loadTree();
        }

        function removeFromTree(gameId) {
            _treeGames.delete(gameId);
            renderGameList();
            populateTreePlayerDropdowns();
            loadTree();
        }

        function clearTree() {
            _treeGames.clear();
            _selectedTreeGames.clear();
            $('.tree-checkbox').prop('checked', false);
            updateSelectionCount();
            renderGameList();
            populateTreePlayerDropdowns();
            loadTree();
        }

        function selectAllVisibleGames() {
            $('#game-list .tree-checkbox').each(function () {
                const id = parseInt($(this).data('game-id'));
                _selectedTreeGames.add(id);
                $(this).prop('checked', true);
            });
            updateSelectionCount();
        }

        function updateSelectionCount() {
            const nSel = _selectedTreeGames.size;
            const nTree = _treeGames.size;
            let text = '';
            if (nSel > 0) text += nSel + ' checked';
            if (nSel > 0 && nTree > 0) text += ' · ';
            if (nTree > 0) text += nTree + ' in tree';
            $('#selected-count').text(text);
            $('#add-to-tree-btn').prop('disabled', nSel === 0);
        }

        function loadData() {
            // Fetch folders and games together, then load tree
            $.when($.get('/folders'), $.get('/games')).done(function (foldersRes, gamesRes) {
                const folderData = foldersRes[0];
                _cachedFolders = folderData.folders;
                _cachedGames = gamesRes[0];
                renderGameList();
                populateTreePlayerDropdowns();
                loadTree();
            });
        }

        function renderGameList() {
            const p = $('#player-filter').val();
            const query = ($('#game-search').val() || '').trim().toLowerCase();
            const $list = $('#game-list').empty();

            // "New Folder" button
            $list.append(`<div class="mb-3">
                <button onclick="createFolder()" class="bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded text-[10px] font-medium">+ New Folder</button>
            </div>`);

            // Group games by folder_id
            const gamesByFolder = {};
            _cachedGames.forEach(g => {
                const fid = g.folder_id || '__unfiled__';
                if (!gamesByFolder[fid]) gamesByFolder[fid] = [];
                gamesByFolder[fid].push(g);
            });

            // Helper: check if a game matches the search query
            const isTreeFilter = query === '::tree';
            function gameMatches(g) {
                if (!query) return true;
                if (isTreeFilter) return _treeGames.has(g.id);
                const w = (g.white || '').toLowerCase();
                const b = (g.black || '').toLowerCase();
                const n = (g.name || '').toLowerCase();
                return w.includes(query) || b.includes(query) || n.includes(query);
            }

            // Render each folder
            _cachedFolders.forEach(f => {
                const folderGames = gamesByFolder[f.id] || [];
                const folderNameMatch = query && f.name.toLowerCase().includes(query);
                // If folder name matches, show all its games; otherwise filter games
                const filteredGames = folderNameMatch ? folderGames : folderGames.filter(gameMatches);
                // Skip empty folders when searching, unless the folder itself matches
                if (query && !folderNameMatch && filteredGames.length === 0) return;
                const $section = $(renderFolderSection(f, filteredGames, p));
                // Auto-expand folders that have search matches
                if (query && (folderNameMatch || filteredGames.length > 0)) {
                    $section.find(`#folder-${f.id}`).removeClass('hidden');
                    $section.find(`#folder-icon-${f.id}`).text('📂');
                }
                $list.append($section);
            });

            // Render unfiled games
            const unfiledGames = (gamesByFolder['__unfiled__'] || []).filter(gameMatches);
            if (!query || unfiledGames.length > 0) {
                $list.append(`<div class="space-y-1 folder-drop-zone" data-folder-id=""
                     ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
                    <div class="folder-header"></div>
                    ${unfiledGames.map(g => renderGameItem(g, p)).join('')}
                    ${!query && unfiledGames.length === 0 ? '<div class="border border-dashed border-gray-700 rounded p-3 text-center text-[10px] text-gray-600 mt-2">Drop here to remove from folder</div>' : ''}
                </div>`);
            }
        }

        function filterGameList() {
            const q = $('#game-search').val();
            $('#game-search-clear').toggleClass('hidden', !q);
            renderGameList();
        }

        function clearGameSearch() {
            $('#game-search').val('').focus();
            $('#game-search-clear').addClass('hidden');
            renderGameList();
        }

        function renderFolderSection(folder, games, player) {
            const gamesHtml = games.map(g => renderGameItem(g, player)).join('');
            return `
                <div class="mb-3 folder-drop-zone" data-folder-id="${folder.id}"
                     ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
                    <div class="flex justify-between items-center bg-gray-700/50 px-3 py-2 rounded-t cursor-pointer folder-header"
                         onclick="toggleFolderIcon(${folder.id})">
                        <div class="flex items-center gap-2">
                            <span id="folder-icon-${folder.id}" class="text-[13px]">📁</span>
                            <span class="text-[11px] font-bold text-blue-300 cursor-pointer hover:underline" onclick="event.stopPropagation(); renameFolder(${folder.id}, '${folder.name.replace(/'/g, "\\'")}')">${folder.name}</span>
                            <span class="text-[9px] text-gray-500">${folder.game_count} games • ${folder.puzzle_count} puzzles</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <button onclick="event.stopPropagation(); scanFolder(${folder.id})" id="scan-folder-btn-${folder.id}" class="text-blue-400 hover:text-blue-300 text-[10px]" title="Scan all games for blunders">🔍 Scan All</button>
                            <button onclick="event.stopPropagation(); deleteFolder(${folder.id})" class="text-red-500 hover:text-red-400 text-[10px]">✕</button>
                        </div>
                    </div>
                    <div id="folder-${folder.id}" class="border-l-2 border-blue-800/40 ml-3 pl-2 space-y-1 mt-1 hidden">
                        ${gamesHtml || '<div class="text-[10px] text-gray-500 italic px-3 py-2">No games in this folder</div>'}
                    </div>
                </div>`;
        }

        function toggleFolderIcon(id) {
            const $contents = $(`#folder-${id}`);
            const $icon = $(`#folder-icon-${id}`);
            $contents.toggleClass('hidden');
            $icon.text($contents.hasClass('hidden') ? '📁' : '📂');
        }

        async function scanFolder(folderId) {
            // Get all game IDs in this folder
            const gameIds = [];
            $(`#folder-${folderId} .game-draggable`).each(function () {
                gameIds.push($(this).data('game-id'));
            });
            if (!gameIds.length) return;

            const $btn = $(`#scan-folder-btn-${folderId}`);
            $btn.prop('disabled', true).text('⏳ 0/' + gameIds.length);

            for (let i = 0; i < gameIds.length; i++) {
                $btn.text(`⏳ ${i + 1}/${gameIds.length}`);
                await new Promise((resolve, reject) => {
                    fetch(`/games/${gameIds[i]}/scan-chunked`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chunk_size: 10, delay_ms: 500, threshold: 100 })
                    }).then(response => {
                        const reader = response.body.getReader();
                        function read() {
                            reader.read().then(({ done }) => {
                                if (done) { resolve(); return; }
                                read();
                            }).catch(reject);
                        }
                        read();
                    }).catch(reject);
                });
            }

            $btn.text('✓ Done').removeClass('text-blue-400').addClass('text-green-400');
            setTimeout(() => {
                $btn.text('🔍 Scan All').removeClass('text-green-400').addClass('text-blue-400').prop('disabled', false);
            }, 2000);
            loadData();
        }

        function renderGameItem(g, player) {
            const w = g.white || "?", b = g.black || "?";
            const p = player || '';
            const isW = p && w.toLowerCase().includes(p.toLowerCase()), isB = p && b.toLowerCase().includes(p.toLowerCase());
            const nameHtml = g.name ? `<div class="text-[10px] text-purple-300 font-medium">${g.name}</div>` : '';
            const isChecked = _selectedTreeGames.has(g.id) ? 'checked' : '';
            const inTree = _treeGames.has(g.id);
            const treeClass = inTree ? ' game-in-tree' : '';
            const treeBadge = inTree ? `<span class="in-tree-badge" onclick="event.stopPropagation()">🌳 In Tree<span class="remove-tree" onclick="removeFromTree(${g.id})" title="Remove from tree">✕</span></span>` : '';

            return `<div class="bg-gray-750 rounded border border-gray-700 text-sm overflow-hidden game-draggable${treeClass}"
                         draggable="true" data-game-id="${g.id}"
                         ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)">
                <div class="p-3 flex justify-between items-center cursor-pointer hover:bg-gray-700 transition" onclick="toggleGameExpand(${g.id})">
                    <div class="flex items-center gap-2">
                        <input type="checkbox" class="tree-checkbox" data-game-id="${g.id}" ${isChecked}
                            onclick="event.stopPropagation(); toggleTreeGame(${g.id})" title="Select for tree">
                        <span class="drag-grip text-gray-600 cursor-grab text-[12px] select-none" title="Drag to move">⠿</span>
                        <span id="chevron-${g.id}" class="text-gray-500 text-[10px] transform transition-transform">▶</span>
                        <div>
                            ${nameHtml}
                            <div class="font-bold text-xs"><span class="${isW ? 'highlight-player' : ''}">${w}</span> vs <span class="${isB ? 'highlight-player' : ''}">${b}</span></div>
                            <div class="text-gray-400 text-[10px]">${g.date} • ${g.result}</div>
                        </div>
                    </div>
                    <div class="flex items-center space-x-2">
                        ${treeBadge}
                        <button onclick="event.stopPropagation(); loadGameMoves(${g.id})" class="text-blue-400 hover:text-blue-300 text-[10px] border border-blue-900/30 px-2 py-1 rounded bg-blue-900/10">LOAD</button>
                        <button onclick="event.stopPropagation(); requestDelete(${g.id}, this)" class="text-red-500 hover:text-red-400 text-[10px] min-w-[40px] text-right">Delete</button>
                    </div>
                </div>
                <div id="game-details-${g.id}" class="hidden border-t border-gray-700 bg-gray-900/50 p-2">
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-[10px] font-bold text-gray-500 uppercase">Blunders & Puzzles</span>
                        <div class="flex items-center gap-2">
                            <label class="text-[9px] text-gray-400 flex items-center gap-1">Threshold
                                <input type="number" id="threshold-${g.id}" value="100" min="30" max="500" step="10"
                                    class="bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-[10px] text-white w-14 text-center focus:outline-none focus:border-blue-500">
                                <span class="text-gray-500">cp</span>
                            </label>
                            <button onclick="scanGame(${g.id})" class="bg-blue-600 hover:bg-blue-500 text-white px-2 py-0.5 rounded text-[10px]">Scan</button>
                        </div>
                    </div>
                    <div id="puzzles-${g.id}" class="space-y-1">
                        <div class="text-[10px] text-gray-500 italic">Click scan to find blunders...</div>
                    </div>
                </div>
            </div>`;
        }

        // --- Drag and Drop ---
        function handleDragStart(e) {
            e.dataTransfer.setData('text/plain', e.currentTarget.dataset.gameId);
            e.dataTransfer.effectAllowed = 'move';
            e.currentTarget.classList.add('dragging');
        }

        function handleDragEnd(e) {
            e.currentTarget.classList.remove('dragging');
            document.querySelectorAll('.folder-drop-zone').forEach(el => el.classList.remove('drag-over'));
        }

        function handleDragOver(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const zone = e.currentTarget.closest('.folder-drop-zone');
            if (zone) zone.classList.add('drag-over');
        }

        function handleDragLeave(e) {
            const zone = e.currentTarget.closest('.folder-drop-zone');
            // Only remove if we're actually leaving the zone (not entering a child)
            if (zone && !zone.contains(e.relatedTarget)) {
                zone.classList.remove('drag-over');
            }
        }

        function handleDrop(e) {
            e.preventDefault();
            const zone = e.currentTarget.closest('.folder-drop-zone');
            if (zone) zone.classList.remove('drag-over');
            const gameId = parseInt(e.dataTransfer.getData('text/plain'));
            const folderId = zone ? zone.dataset.folderId : '';
            moveGameToFolder(gameId, folderId);
        }

        function createFolder() {
            const name = prompt('Folder name:');
            if (!name || !name.trim()) return;
            $.ajax({
                url: '/folders',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ name: name.trim() }),
                success: loadData
            });
        }

        function renameFolder(id, currentName) {
            const name = prompt('Rename folder:', currentName);
            if (!name || !name.trim()) return;
            $.ajax({
                url: '/folders/' + id,
                type: 'PUT',
                contentType: 'application/json',
                data: JSON.stringify({ name: name.trim() }),
                success: loadData
            });
        }

        function deleteFolder(id) {
            const $modal = $('#delete-folder-modal');
            $modal.removeClass('hidden').find('#delete-folder-name').text(
                $(`#folder-icon-${id}`).parent().find('.text-blue-300').text()
            );
            // Bind buttons
            $('#dfm-cancel').off('click').on('click', () => $modal.addClass('hidden'));
            $('#dfm-keep').off('click').on('click', () => {
                $modal.addClass('hidden');
                $.ajax({ url: '/folders/' + id, type: 'DELETE', success: loadData });
            });
            $('#dfm-delete-all').off('click').on('click', () => {
                $modal.addClass('hidden');
                $.ajax({ url: '/folders/' + id + '?delete_games=true', type: 'DELETE', success: loadData });
            });
        }

        function moveGameToFolder(gameId, folderId) {
            $.ajax({
                url: '/games/' + gameId + '/move',
                type: 'PUT',
                contentType: 'application/json',
                data: JSON.stringify({ folder_id: folderId ? parseInt(folderId) : null }),
                success: loadData
            });
        }

        // --- Lichess Import ---
        function loadLichessSettings() {
            const saved = localStorage.getItem('lichess_settings');
            if (saved) {
                try {
                    const s = JSON.parse(saved);
                    if (s.username) $('#lichess-username').val(s.username);
                    if (s.token) $('#lichess-token').val(s.token);
                } catch (e) { }
            }
        }

        function saveLichessSettings() {
            const settings = {
                username: $('#lichess-username').val().trim(),
                token: $('#lichess-token').val().trim()
            };
            localStorage.setItem('lichess_settings', JSON.stringify(settings));
            showLichessStatus('Settings saved ✓', 'text-green-400');
        }

        function getLichessHeaders() {
            const token = $('#lichess-token').val().trim();
            const headers = {};
            if (token) headers['X-Lichess-Token'] = token;
            return headers;
        }

        function showLichessStatus(msg, colorClass) {
            const $s = $('#lichess-status');
            $s.text(msg).removeClass('hidden text-gray-500 text-green-400 text-red-400 text-blue-400').addClass(colorClass || 'text-gray-500');
            if (colorClass === 'text-green-400') {
                setTimeout(() => $s.addClass('hidden'), 2000);
            }
        }

        function browseLichessStudies() {
            const username = $('#lichess-username').val().trim();
            if (!username) {
                showLichessStatus('Enter a Lichess username', 'text-red-400');
                return;
            }

            showLichessStatus('Loading studies...', 'text-blue-400');
            const $list = $('#lichess-studies').empty().removeClass('hidden');

            $.ajax({
                url: '/lichess/studies?username=' + encodeURIComponent(username),
                headers: getLichessHeaders(),
                success: function (studies) {
                    if (!studies.length) {
                        showLichessStatus('No studies found', 'text-gray-500');
                        return;
                    }
                    showLichessStatus(`Found ${studies.length} study(ies)`, 'text-green-400');
                    studies.forEach(s => {
                        const dateStr = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : '';
                        $list.append(`
                            <div class="flex justify-between items-center bg-gray-700/30 rounded px-3 py-2 border border-gray-700">
                                <div>
                                    <div class="text-[11px] font-medium text-gray-200">${s.name}</div>
                                    <div class="text-[9px] text-gray-500">${s.chapters} chapter(s) ${dateStr ? '• ' + dateStr : ''}</div>
                                </div>
                                <button onclick="importLichessStudy('${s.id}', '${s.name.replace(/'/g, "\\'")}', ${s.createdAt || 0})"
                                    id="import-btn-${s.id}"
                                    class="bg-purple-600 hover:bg-purple-500 text-white px-2 py-0.5 rounded text-[10px]">Import</button>
                            </div>
                        `);
                    });
                },
                error: function (xhr) {
                    const err = xhr.responseJSON?.error || 'Failed to load studies';
                    showLichessStatus(err, 'text-red-400');
                }
            });
        }

        function importLichessStudy(studyId, studyName, createdAt) {
            const $btn = $(`#import-btn-${studyId}`);
            $btn.text('Importing...').prop('disabled', true).removeClass('bg-purple-600 hover:bg-purple-500').addClass('bg-gray-600');
            const studyDate = createdAt ? new Date(createdAt).toISOString().split('T')[0] : '';

            $.ajax({
                url: '/lichess/import',
                type: 'POST',
                contentType: 'application/json',
                headers: getLichessHeaders(),
                data: JSON.stringify({ study_id: studyId, study_name: studyName, study_date: studyDate }),
                success: function (res) {
                    $btn.text(`✓ ${res.imported} games`).removeClass('bg-gray-600').addClass('bg-green-700');
                    loadData();
                },
                error: function (xhr) {
                    const err = xhr.responseJSON?.error || 'Import failed';
                    $btn.text('Error').removeClass('bg-gray-600').addClass('bg-red-700');
                    showLichessStatus(err, 'text-red-400');
                }
            });
        }

        function toggleGameExpand(id) {
            const $details = $(`#game-details-${id}`);
            const $chevron = $(`#chevron-${id}`);
            const isHidden = $details.hasClass('hidden');

            if (isHidden) {
                $details.removeClass('hidden');
                $chevron.css('transform', 'rotate(90deg)');
                loadPuzzles(id);
            } else {
                $details.addClass('hidden');
                $chevron.css('transform', 'rotate(0deg)');
            }
        }

        function loadPuzzles(id) {
            const $container = $(`#puzzles-${id}`);
            $container.html('<div class="text-[10px] text-gray-500 italic">Loading...</div>');
            $.get(`/games/${id}/puzzles`, function (puzzles) {
                if (!puzzles || puzzles.length === 0) {
                    $container.html('<div class="text-[10px] text-gray-500 italic">No puzzles found. Click scan.</div>');
                    return;
                }
                renderPuzzles(id, puzzles);
            });
        }

        function scanGame(id) {
            const $container = $(`#puzzles-${id}`);
            $container.html(`
                <div class="mb-2">
                    <div class="flex justify-between text-[10px] text-blue-400 mb-1">
                        <span id="scan-status-${id}">Scanning...</span>
                        <span id="scan-pct-${id}">0%</span>
                    </div>
                    <div class="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                        <div id="scan-bar-${id}" class="bg-blue-500 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
                    </div>
                </div>
            `);

            // Use fetch + ReadableStream to consume SSE from POST endpoint
            const threshold = parseInt($(`#threshold-${id}`).val()) || 100;
            fetch(`/games/${id}/scan-chunked`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chunk_size: 10, delay_ms: 500, threshold: threshold })
            }).then(response => {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                function read() {
                    reader.read().then(({ done, value }) => {
                        if (done) {
                            loadPuzzles(id);
                            return;
                        }
                        buffer += decoder.decode(value, { stream: true });
                        // Parse SSE lines
                        const lines = buffer.split('\n');
                        buffer = lines.pop(); // keep incomplete line in buffer
                        lines.forEach(line => {
                            if (line.startsWith('data: ')) {
                                try {
                                    const evt = JSON.parse(line.substring(6));
                                    const pct = Math.round((evt.progress / evt.total) * 100);
                                    $(`#scan-bar-${id}`).css('width', pct + '%');
                                    $(`#scan-pct-${id}`).text(pct + '%');
                                    $(`#scan-status-${id}`).text(
                                        evt.done
                                            ? `Done — ${evt.total_puzzles} blunder(s) found`
                                            : `Move ${evt.progress}/${evt.total} (${evt.puzzles_so_far} found)`
                                    );
                                    // Live-update eval chart if this is the selected game
                                    if (evt.evals && id === selectedGameId) {
                                        gameEvals = evt.evals;
                                        drawEvalChart(gameEvals, currentMoveIndex);
                                    }
                                    if (evt.done) {
                                        $(`#scan-bar-${id}`).removeClass('bg-blue-500').addClass('bg-green-500');
                                        setTimeout(() => loadPuzzles(id), 800);
                                    }
                                } catch (e) { /* skip malformed line */ }
                            }
                        });
                        read();
                    });
                }
                read();
            }).catch(() => {
                $container.html('<div class="text-[10px] text-red-400 italic">Scan failed.</div>');
            });
        }

        function renderPuzzles(gameId, puzzles) {
            const $container = $(`#puzzles-${gameId}`).empty();
            puzzles.forEach(p => {
                const diff = Math.abs(p.score_before - p.score_after) / 100;
                const side = p.turn === 'white' ? 'White' : 'Black';
                const $row = $(`<div class="flex justify-between items-center bg-gray-800 p-2 rounded cursor-pointer hover:bg-gray-700 border-l-2 border-red-500" onclick="selectGame(${gameId}, function() { jumpToFen('${p.fen}'); })">
                    <div>
                        <div class="text-[10px] font-bold text-gray-300">Move ${p.move_number} (${side})</div>
                        <div class="text-[9px] text-gray-500">Eval drop: ${diff.toFixed(1)}</div>
                    </div>
                    <div class="text-xs text-gray-400">➜</div>
                </div>`);
                $container.append($row);
            });
        }

        function loadGameMoves(id) {
            selectGame(id);
        }

        function requestDelete(id, btn) {
            const $btn = $(btn);
            if ($btn.text() === 'Delete') {
                $btn.text('Confirm?').addClass('font-bold text-red-300');
                // Auto-revert after 3s
                setTimeout(() => {
                    if (document.body.contains(btn) && $btn.text() === 'Confirm?') {
                        $btn.text('Delete').removeClass('font-bold text-red-300');
                    }
                }, 3000);
            } else {
                // Perform delete
                $btn.text('Deleting...').prop('disabled', true);
                $.ajax({
                    url: '/games/' + id,
                    type: 'DELETE',
                    success: function () {
                        loadData();
                    },
                    error: function (err) {
                        alert('Error deleting game: ' + (err.statusText || 'Unknown error'));
                        loadData();
                    }
                });
            }
        }
        function flipBoard(s) { board.orientation(s); }
        $('#pgn-upload').change(function (e) {
            const fd = new FormData(); fd.append('file', e.target.files[0]);
            $.ajax({ url: '/upload', type: 'POST', data: fd, processData: false, contentType: false, success: loadData });
        });
        $('#player-filter').on('input', loadData);
        board = Chessboard('myBoard', { draggable: true, position: 'start', onDrop: onDrop, moveSpeed: 0, snapSpeed: 0, pieceTheme: '/static/img/chesspieces/svg/{piece}.svg' });
        loadLichessSettings();
        loadData();
        // Initial sizing after board is ready
        setTimeout(() => { resizeBoardArea(); board.resize(); const bh = $('#myBoard').height(); if (bh > 0) $('#eval-bar-v').height(bh); }, 50);

        $(window).resize(function () {
            resizeBoardArea();
            board.resize();
            const bh = $('#myBoard').height();
            if (bh > 0) $('#eval-bar-v').height(bh);
            const svg = document.getElementById('arrow-svg');
            while (svg && svg.firstChild) svg.removeChild(svg.firstChild);
            updateChartIndicator();
        });

        function resizeBoardArea() {
            const headerH = $('header').outerHeight() || 0;
            const viewH = window.innerHeight;
            const availH = viewH - headerH - 8;
            const chartH = $('#eval-chart-wrap').is(':visible') ? 128 : 8;
            const evalBarW = 38;
            const boardAreaW = $('#board-area').width();
            // Board is square: side = min(available height - chart, available width - eval bar - padding)
            const maxBoardSide = Math.min(availH - chartH, boardAreaW - evalBarW - 16);
            const boardSide = Math.max(250, maxBoardSide);
            // Set explicit width on the board wrapper so chessboard.js respects it
            $('#board-wrapper').css('width', boardSide + 'px');
            $('#eval-chart-wrap').css('width', (boardSide + evalBarW) + 'px');
        }

        resizeBoardArea();

        $('#btn-start').click(() => jumpToMove(-1));
        $('#btn-prev').click(() => jumpToMove(currentMoveIndex - 1));
        $('#btn-next').click(() => jumpToMove(currentMoveIndex + 1));
        $('#btn-end').click(() => jumpToMove(gameMoves.length - 1));

        $(document).keydown(function (e) {
            // Only suppress hotkeys when actually typing in a text field
            const focused = document.activeElement;
            const tag = focused ? focused.tagName.toLowerCase() : '';
            const inputType = focused ? (focused.type || '').toLowerCase() : '';
            const isTyping = tag === 'textarea' || (tag === 'input' && ['text', 'search', 'url', 'email', 'password'].includes(inputType));
            if (isTyping) return;

            if (e.which === 37) { e.preventDefault(); focused && focused.blur(); jumpToMove(currentMoveIndex - 1); }
            else if (e.which === 39) { e.preventDefault(); focused && focused.blur(); jumpToMove(currentMoveIndex + 1); }
            else if (e.which === 38) { e.preventDefault(); focused && focused.blur(); jumpToMove(-1); }
            else if (e.which === 40) { e.preventDefault(); focused && focused.blur(); jumpToMove(gameMoves.length - 1); }
            else if (e.which === 70) { e.preventDefault(); focused && focused.blur(); board.flip(); fetchAnalysis(); }
        });
    </script>
    <!-- Delete Folder Modal -->
    <div id="delete-folder-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onclick="$('#delete-folder-modal').addClass('hidden')"></div>
        <div class="relative bg-gray-800 border border-gray-600 rounded-lg shadow-2xl p-5 w-80 max-w-[90vw]">
            <h3 class="text-sm font-bold text-gray-100 mb-1">Delete Folder</h3>
            <p class="text-[11px] text-gray-400 mb-4">How would you like to delete <span id="delete-folder-name"
                    class="text-blue-300 font-medium"></span>?</p>
            <div class="space-y-2">
                <button id="dfm-keep"
                    class="w-full text-left px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 border border-gray-600 transition">
                    <div class="text-[11px] font-medium text-gray-200">📂 Keep games</div>
                    <div class="text-[9px] text-gray-500">Games will be moved to Unfiled</div>
                </button>
                <button id="dfm-delete-all"
                    class="w-full text-left px-3 py-2 rounded bg-red-900/30 hover:bg-red-900/50 border border-red-800/50 transition">
                    <div class="text-[11px] font-medium text-red-300">🗑️ Delete everything</div>
                    <div class="text-[9px] text-red-400/70">Permanently remove all games and puzzles</div>
                </button>
            </div>
            <button id="dfm-cancel"
                class="w-full mt-3 text-[10px] text-gray-500 hover:text-gray-300 transition">Cancel</button>
        </div>
    </div>
</body>

