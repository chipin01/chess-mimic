/* Global variables and State */
let board = null;
let game = new Chess();
let treeData = {};
let selectedGameId = null;
let currentMoveIndex = -1; 
let gameMoves = [];
let gameEvals = [];
const ARROW_COLOR = '#60a5fa';

let _cachedFolders = [];
let _cachedGames = [];
let _selectedTreeGames = new Set();
let _treeGames = new Set();
let _treeSide = 'white';

/* Core Logic */
function onDrop(source, target) {
    let move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';
    board.position(game.fen(), false);
    const fen = game.fen();
    const moveIdx = gameMoves.findIndex(m => m.fen === fen);
    if (moveIdx !== -1) currentMoveIndex = moveIdx;
    updateUI();
    fetchAnalysis();
}

function updateUI() {
    board.resize();
    const bh = $('#myBoard').height();
    if (bh > 0) $('#eval-bar-v').height(bh);
    updateTreeHighlight();
    $('.move-btn').removeClass('active');
    if (currentMoveIndex !== -1) $(`#move-btn-${currentMoveIndex}`).addClass('active');
    if (selectedGameId) {
        $('#annotation-box').removeClass('hidden');
        const moveData = gameMoves[currentMoveIndex];
        $('#comment-input').val(moveData && moveData.comment ? moveData.comment : '');
    }
}

function jumpToMove(idx) {
    currentMoveIndex = idx;
    if (idx === -1) {
        game.reset();
    } else {
        const safeIdx = Math.max(-1, Math.min(idx, gameMoves.length - 1));
        currentMoveIndex = safeIdx;
        if (safeIdx === -1) game.reset();
        else game.load(gameMoves[safeIdx].fen);
    }
    board.position(game.fen(), false);
    updateUI();
    fetchAnalysis();
    updateChartIndicator();
}

function showTab(tab) {
    $('.tab-content').addClass('hidden'); 
    $(`#content-${tab}`).removeClass('hidden');
    $('.flex-1.py-3').removeClass('active-tab').addClass('text-gray-400');
    $(`#tab-${tab}`).addClass('active-tab').removeClass('text-gray-400');
}

/* API / Engine Calls */
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
        // Handle tactical and positional data rendering here...
    });
}

function loadData() {
    $.when($.get('/folders'), $.get('/games')).done(function (foldersRes, gamesRes) {
        _cachedFolders = foldersRes[0].folders;
        _cachedGames = gamesRes[0];
        renderGameList();
        populateTreePlayerDropdowns();
        loadTree();
    });
}

/* Initialization */
$(document).ready(function() {
    board = Chessboard('myBoard', { 
        draggable: true, 
        position: 'start', 
        onDrop: onDrop, 
        moveSpeed: 0, 
        snapSpeed: 0, 
        pieceTheme: '/static/img/chesspieces/svg/{piece}.svg' 
    });
    loadData();
});
