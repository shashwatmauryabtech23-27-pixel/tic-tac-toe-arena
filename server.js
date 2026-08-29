const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = 3001;

// Game state
let players = new Map(); // socket.id -> player data
let waitingPlayer = null;
let activeGames = new Map(); // gameId -> game data
let leaderboard = new Map(); // username -> stats
let tournamentMode = false;
let tournamentBracket = [];

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log(`[CONNECTION] User connected: ${socket.id}`);

    // Player joins
    socket.on('join', (username) => {
        if (!username || username.trim() === '') {
            socket.emit('error', 'Invalid username');
            return;
        }

        // Check if username exists
        const existingPlayer = Array.from(players.values()).find(p => p.username === username);
        if (existingPlayer) {
            socket.emit('error', 'Username already taken');
            return;
        }

        players.set(socket.id, {
            id: socket.id,
            username: username,
            inGame: false
        });

        // Initialize leaderboard entry
        if (!leaderboard.has(username)) {
            leaderboard.set(username, {
                username: username,
                wins: 0,
                losses: 0,
                draws: 0,
                points: 0
            });
        }

        socket.emit('joined', { username: username });
        broadcastLobbyUpdate();
        console.log(`[JOIN] ${username} joined`);
    });

    // Find match (Quick Match mode)
    socket.on('findMatch', () => {
        const player = players.get(socket.id);
        if (!player || player.inGame) return;

        if (waitingPlayer && waitingPlayer !== socket.id) {
            // Create game
            const player2 = players.get(waitingPlayer);
            if (player2 && !player2.inGame) {
                startGame(socket.id, waitingPlayer);
                waitingPlayer = null;
            } else {
                waitingPlayer = socket.id;
                socket.emit('waiting', 'Searching for opponent...');
            }
        } else {
            waitingPlayer = socket.id;
            socket.emit('waiting', 'Searching for opponent...');
        }
    });

    // Cancel match search
    socket.on('cancelSearch', () => {
        if (waitingPlayer === socket.id) {
            waitingPlayer = null;
        }
        socket.emit('searchCancelled');
    });

    // Make move
    socket.on('makeMove', (data) => {
        const { gameId, position } = data;
        const game = activeGames.get(gameId);
        
        if (!game || game.finished) return;
        if (game.currentTurn !== socket.id) return;
        if (game.board[position] !== '') return;

        // Make move
        const player = players.get(socket.id);
        const symbol = game.player1 === socket.id ? 'X' : 'O';
        game.board[position] = symbol;
        game.moveCount++;

        // Check win
        const winner = checkWinner(game.board);
        
        if (winner) {
            endGame(gameId, winner === 'X' ? game.player1 : game.player2, 'win');
        } else if (game.moveCount === 9) {
            endGame(gameId, null, 'draw');
        } else {
            // Switch turn
            game.currentTurn = game.currentTurn === game.player1 ? game.player2 : game.player1;
            broadcastGameState(gameId);
        }
    });

    // Start tournament
    socket.on('startTournament', () => {
        const availablePlayers = Array.from(players.values()).filter(p => !p.inGame);
        
        if (availablePlayers.length < 2) {
            socket.emit('error', 'Need at least 2 players for tournament');
            return;
        }

        startTournament(availablePlayers);
    });

    // Rematch request
    socket.on('rematch', (gameId) => {
        const game = activeGames.get(gameId);
        if (!game) return;

        const opponent = game.player1 === socket.id ? game.player2 : game.player1;
        io.to(opponent).emit('rematchRequest', socket.id);
    });

    // Accept rematch
    socket.on('acceptRematch', (requesterId) => {
        startGame(socket.id, requesterId);
    });

    // Chat message
    socket.on('chatMessage', (message) => {
        const player = players.get(socket.id);
        if (!player) return;

        io.emit('chatMessage', {
            username: player.username,
            message: message,
            timestamp: Date.now()
        });
    });

    // Disconnect
    socket.on('disconnect', () => {
        const player = players.get(socket.id);
        if (player) {
            console.log(`[DISCONNECT] ${player.username} disconnected`);
            
            // Handle active games
            activeGames.forEach((game, gameId) => {
                if (game.player1 === socket.id || game.player2 === socket.id) {
                    const opponent = game.player1 === socket.id ? game.player2 : game.player1;
                    io.to(opponent).emit('opponentDisconnected');
                    activeGames.delete(gameId);
                }
            });

            players.delete(socket.id);
            
            if (waitingPlayer === socket.id) {
                waitingPlayer = null;
            }
        }
        
        broadcastLobbyUpdate();
    });
});

function startGame(player1Id, player2Id) {
    const gameId = `game_${Date.now()}`;
    const player1 = players.get(player1Id);
    const player2 = players.get(player2Id);

    player1.inGame = true;
    player2.inGame = true;

    const game = {
        id: gameId,
        player1: player1Id,
        player2: player2Id,
        player1Name: player1.username,
        player2Name: player2.username,
        board: ['', '', '', '', '', '', '', '', ''],
        currentTurn: player1Id,
        moveCount: 0,
        finished: false
    };

    activeGames.set(gameId, game);

    io.to(player1Id).emit('gameStart', {
        gameId: gameId,
        opponent: player2.username,
        symbol: 'X',
        yourTurn: true
    });

    io.to(player2Id).emit('gameStart', {
        gameId: gameId,
        opponent: player1.username,
        symbol: 'O',
        yourTurn: false
    });

    broadcastGameState(gameId);
    broadcastLobbyUpdate();
    console.log(`[GAME START] ${player1.username} vs ${player2.username}`);
}

function broadcastGameState(gameId) {
    const game = activeGames.get(gameId);
    if (!game) return;

    const gameState = {
        board: game.board,
        currentTurn: game.currentTurn,
        player1Name: game.player1Name,
        player2Name: game.player2Name
    };

    io.to(game.player1).emit('gameUpdate', gameState);
    io.to(game.player2).emit('gameUpdate', gameState);
}

function checkWinner(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
        [0, 4, 8], [2, 4, 6] // diagonals
    ];

    for (let line of lines) {
        const [a, b, c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return null;
}

function endGame(gameId, winnerId, result) {
    const game = activeGames.get(gameId);
    if (!game) return;

    game.finished = true;

    const player1 = players.get(game.player1);
    const player2 = players.get(game.player2);

    if (player1) player1.inGame = false;
    if (player2) player2.inGame = false;

    // Update leaderboard
    if (result === 'win') {
        const winner = players.get(winnerId);
        const loser = players.get(winnerId === game.player1 ? game.player2 : game.player1);
        
        if (winner && loser) {
            const winnerStats = leaderboard.get(winner.username);
            const loserStats = leaderboard.get(loser.username);
            
            winnerStats.wins++;
            winnerStats.points += 3;
            loserStats.losses++;
            
            leaderboard.set(winner.username, winnerStats);
            leaderboard.set(loser.username, loserStats);
        }

        io.to(winnerId).emit('gameEnd', { result: 'win', gameId: gameId });
        io.to(winnerId === game.player1 ? game.player2 : game.player1).emit('gameEnd', { result: 'loss', gameId: gameId });
    } else {
        // Draw
        if (player1 && player2) {
            const stats1 = leaderboard.get(player1.username);
            const stats2 = leaderboard.get(player2.username);
            
            stats1.draws++;
            stats1.points += 1;
            stats2.draws++;
            stats2.points += 1;
            
            leaderboard.set(player1.username, stats1);
            leaderboard.set(player2.username, stats2);
        }

        io.to(game.player1).emit('gameEnd', { result: 'draw', gameId: gameId });
        io.to(game.player2).emit('gameEnd', { result: 'draw', gameId: gameId });
    }

    setTimeout(() => {
        activeGames.delete(gameId);
    }, 1000);

    broadcastLobbyUpdate();
}

function startTournament(availablePlayers) {
    // Shuffle players
    const shuffled = [...availablePlayers].sort(() => Math.random() - 0.5);
    
    // Create bracket pairs
    tournamentBracket = [];
    for (let i = 0; i < shuffled.length; i += 2) {
        if (i + 1 < shuffled.length) {
            tournamentBracket.push([shuffled[i], shuffled[i + 1]]);
        }
    }

    tournamentMode = true;
    
    // Start all first round matches
    tournamentBracket.forEach(pair => {
        startGame(pair[0].id, pair[1].id);
    });

    io.emit('tournamentStart', {
        bracket: tournamentBracket.map(pair => [pair[0].username, pair[1].username])
    });

    console.log('[TOURNAMENT] Started with', shuffled.length, 'players');
}

function broadcastLobbyUpdate() {
    const onlinePlayers = Array.from(players.values()).map(p => ({
        username: p.username,
        inGame: p.inGame
    }));

    const sortedLeaderboard = Array.from(leaderboard.values())
        .sort((a, b) => b.points - a.points)
        .slice(0, 10);

    io.emit('lobbyUpdate', {
        players: onlinePlayers,
        leaderboard: sortedLeaderboard,
        activeGames: activeGames.size
    });
}

http.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log(`>> TIC-TAC-TOE TOURNAMENT SERVER`);
    console.log(`>> Server running on port ${PORT}`);
    console.log(`>> Local: http://localhost:${PORT}`);
    console.log(`>> Network: http://YOUR_IP:${PORT}`);
    console.log('='.repeat(60));
});