let socket;
let currentUsername;
let currentGameId;
let yourSymbol;
let yourTurn = false;

function login() {
    const username = document.getElementById('usernameInput').value.trim();
    if (!username) {
        showStatus('Please enter a username', 'error');
        return;
    }

    socket = io();
    
    socket.emit('join', username);

    socket.on('joined', (data) => {
        currentUsername = data.username;
        document.getElementById('currentUser').textContent = currentUsername;
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('container').style.display = 'flex';
        document.getElementById('sidebar').classList.add('active');
        document.getElementById('mainArea').classList.add('active');
        showStatus('Connected to network');
    });

    socket.on('error', (msg) => {
        showStatus(msg, 'error');
    });

    socket.on('lobbyUpdate', (data) => {
        updatePlayerList(data.players);
        updateLeaderboard(data.leaderboard);
    });

    socket.on('waiting', (msg) => {
        document.getElementById('lobbyMessage').textContent = msg;
    });

    socket.on('searchCancelled', () => {
        document.getElementById('lobbyMessage').textContent = 'Ready to play';
    });

    socket.on('gameStart', (data) => {
        currentGameId = data.gameId;
        yourSymbol = data.symbol;
        yourTurn = data.yourTurn;
        
        document.getElementById('lobbyView').style.display = 'none';
        document.getElementById('gameView').classList.add('active');
        document.getElementById('yourSymbol').textContent = yourSymbol;
        
        showStatus(`Game started! You are ${yourSymbol}`);
        resetBoard();
    });

    socket.on('gameUpdate', (state) => {
        updateBoard(state);
    });

    socket.on('gameEnd', (data) => {
        setTimeout(() => {
            showResult(data.result);
        }, 500);
    });

    socket.on('opponentDisconnected', () => {
        showStatus('Opponent disconnected', 'error');
        returnToLobby();
    });

    socket.on('rematchRequest', (requesterId) => {
        if (confirm('Opponent wants a rematch. Accept?')) {
            socket.emit('acceptRematch', requesterId);
        }
    });

    socket.on('chatMessage', (data) => {
        addChatMessage(data.username, data.message);
    });

    socket.on('tournamentStart', (data) => {
        showStatus('Tournament started!');
    });
}

function findMatch() {
    socket.emit('findMatch');
}

function startTournament() {
    socket.emit('startTournament');
}

function makeMove(position) {
    if (!yourTurn) return;
    
    const cell = document.querySelector(`[data-index="${position}"]`);
    if (cell.classList.contains('filled')) return;

    socket.emit('makeMove', {
        gameId: currentGameId,
        position: position
    });
}

function updateBoard(state) {
    document.getElementById('player1Name').textContent = state.player1Name;
    document.getElementById('player2Name').textContent = state.player2Name;

    state.board.forEach((symbol, index) => {
        const cell = document.querySelector(`[data-index="${index}"]`);
        if (symbol) {
            cell.textContent = symbol;
            cell.classList.add('filled', symbol);
        }
    });

    yourTurn = state.currentTurn === socket.id;
    document.getElementById('turnIndicator').textContent = yourTurn ? 'YOUR TURN' : 'OPPONENT\'S TURN';
    document.getElementById('turnIndicator').style.color = yourTurn ? '#00FF00' : '#FFD700';
}

function resetBoard() {
    document.querySelectorAll('.cell').forEach(cell => {
        cell.textContent = '';
        cell.classList.remove('filled', 'X', 'O');
    });
}

function showResult(result) {
    const modal = document.getElementById('resultModal');
    const content = document.getElementById('resultContent');
    const text = document.getElementById('resultText');
    
    content.classList.remove('loss');
    
    if (result === 'win') {
        text.textContent = 'YOU WIN!';
        text.style.color = '#00FF00';
    } else if (result === 'loss') {
        text.textContent = 'YOU LOSE';
        text.style.color = '#FF4444';
        content.classList.add('loss');
    } else {
        text.textContent = 'DRAW';
        text.style.color = '#FFD700';
    }
    
    modal.classList.add('show');
}

function closeResult() {
    document.getElementById('resultModal').classList.remove('show');
    returnToLobby();
}

function requestRematch() {
    socket.emit('rematch', currentGameId);
    document.getElementById('resultModal').classList.remove('show');
    showStatus('Rematch request sent...');
}

function returnToLobby() {
    document.getElementById('gameView').classList.remove('active');
    document.getElementById('lobbyView').style.display = 'flex';
    resetBoard();
    currentGameId = null;
    yourTurn = false;
}

function updatePlayerList(players) {
    const list = document.getElementById('playerList');
    document.getElementById('playerCount').textContent = players.length;
    
    list.innerHTML = players.map(p => 
        `<div class="playerItem ${p.inGame ? 'inGame' : ''}">> ${p.username} ${p.inGame ? '[IN GAME]' : ''}</div>`
    ).join('');
}

function updateLeaderboard(leaderboard) {
    const list = document.getElementById('leaderboardList');
    
    list.innerHTML = leaderboard.map((p, i) => 
        `<div class="leaderboardItem">
            <span>${i + 1}. ${p.username}</span>
            <span>${p.points}pts</span>
        </div>`
    ).join('');
}

function toggleChat() {
    document.getElementById('chatBox').classList.toggle('active');
}

function sendChat() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (message) {
        socket.emit('chatMessage', message);
        input.value = '';
    }
}

function addChatMessage(username, message) {
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'chatMessage';
    div.innerHTML = `<span class="username">${username}:</span> ${message}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function showStatus(message, type = 'normal') {
    const status = document.getElementById('statusMessage');
    status.textContent = message;
    status.className = 'statusMessage show';
    if (type === 'error') status.classList.add('error');
    
    setTimeout(() => {
        status.classList.remove('show');
    }, 3000);
}

// Enter key handlers
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('usernameInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') login();
    });

    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChat();
    });
});
