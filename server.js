require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 3001;
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');

let dbConnected = false;
let players = new Map();
let waitingPlayer = null;
let activeGames = new Map();
let leaderboard = new Map();
let tournamentBracket = [];

function loadLeaderboard() {
    try {
        if (fs.existsSync(LEADERBOARD_FILE)) {
            const data = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
            const leaderboardData = JSON.parse(data);

            leaderboard.clear();

            leaderboardData.forEach((entry) => {
                leaderboard.set(entry.username, entry);
            });

            console.log(
                `[LOAD] Leaderboard loaded with ${leaderboardData.length} entries`
            );
        }
    } catch (error) {
        console.error('[ERROR] Failed to load leaderboard:', error);
    }
}

function saveLeaderboard() {
    try {
        const leaderboardArray = Array.from(leaderboard.values());

        fs.writeFileSync(
            LEADERBOARD_FILE,
            JSON.stringify(leaderboardArray, null, 2),
            'utf8'
        );

        console.log(
            `[SAVE] Leaderboard saved with ${leaderboardArray.length} entries`
        );
    } catch (error) {
        console.error('[ERROR] Failed to save leaderboard:', error);
    }
}

async function initDatabase() {
    console.log('[INIT] Connecting to MongoDB...');

    dbConnected = await db.connectDB();

    if (dbConnected) {
        console.log('[INIT] MongoDB connected - using database storage');
    } else {
        console.log('[INIT] Using local JSON storage fallback');
        loadLeaderboard();
    }
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log(`[CONNECTION] User connected: ${socket.id}`);

    socket.on('join', async (username) => {
        try {
            const cleanUsername =
                typeof username === 'string' ? username.trim() : '';

            if (!cleanUsername) {
                socket.emit('error', 'Invalid username');
                return;
            }

            const onlinePlayer = Array.from(players.values()).find(
                (player) => player.username === cleanUsername
            );

            if (onlinePlayer) {
                socket.emit('error', 'Username already taken');
                return;
            }

            players.set(socket.id, {
                id: socket.id,
                username: cleanUsername,
                inGame: false
            });

            if (dbConnected) {
                const databasePlayer = await db.getPlayer(cleanUsername);

                if (!databasePlayer) {
                    await db.createPlayer(cleanUsername);
                    console.log(`[DB] New player created: ${cleanUsername}`);
                }
            } else if (!leaderboard.has(cleanUsername)) {
                leaderboard.set(cleanUsername, {
                    username: cleanUsername,
                    wins: 0,
                    losses: 0,
                    draws: 0,
                    points: 0
                });

                saveLeaderboard();
            }

            socket.emit('joined', {
                username: cleanUsername
            });

            await broadcastLobbyUpdate();

            console.log(`[JOIN] ${cleanUsername} joined`);
        } catch (error) {
            console.error('[JOIN ERROR]', error);
            players.delete(socket.id);
            socket.emit('error', 'Unable to join the game');
        }
    });

    socket.on('findMatch', () => {
        const player = players.get(socket.id);

        if (!player || player.inGame) {
            return;
        }

        if (waitingPlayer && waitingPlayer !== socket.id) {
            const opponent = players.get(waitingPlayer);

            if (opponent && !opponent.inGame) {
                const opponentId = waitingPlayer;
                waitingPlayer = null;
                startGame(socket.id, opponentId);
            } else {
                waitingPlayer = socket.id;
                socket.emit('waiting', 'Searching for opponent...');
            }
        } else {
            waitingPlayer = socket.id;
            socket.emit('waiting', 'Searching for opponent...');
        }
    });

    socket.on('cancelSearch', () => {
        if (waitingPlayer === socket.id) {
            waitingPlayer = null;
        }

        socket.emit('searchCancelled');
    });

    socket.on('makeMove', async (data) => {
        try {
            if (!data || typeof data !== 'object') {
                return;
            }

            const { gameId, position } = data;
            const game = activeGames.get(gameId);

            if (!game || game.finished) {
                return;
            }

            if (game.currentTurn !== socket.id) {
                return;
            }

            if (
                !Number.isInteger(position) ||
                position < 0 ||
                position > 8
            ) {
                return;
            }

            if (game.board[position] !== '') {
                return;
            }

            const symbol = game.player1 === socket.id ? 'X' : 'O';

            game.board[position] = symbol;
            game.moveCount += 1;

            const winner = checkWinner(game.board);

            if (winner) {
                const winnerId =
                    winner === 'X' ? game.player1 : game.player2;

                await endGame(gameId, winnerId, 'win');
            } else if (game.moveCount === 9) {
                await endGame(gameId, null, 'draw');
            } else {
                game.currentTurn =
                    game.currentTurn === game.player1
                        ? game.player2
                        : game.player1;

                broadcastGameState(gameId);
            }
        } catch (error) {
            console.error('[MOVE ERROR]', error);
            socket.emit('error', 'Unable to process move');
        }
    });

    socket.on('startTournament', () => {
        const availablePlayers = Array.from(players.values()).filter(
            (player) => !player.inGame
        );

        if (availablePlayers.length < 2) {
            socket.emit(
                'error',
                'Need at least 2 players for tournament'
            );
            return;
        }

        startTournament(availablePlayers);
    });

    socket.on('rematch', (gameId) => {
        const game = activeGames.get(gameId);

        if (!game || !game.finished) {
            return;
        }

        const opponentId =
            game.player1 === socket.id
                ? game.player2
                : game.player1;

        if (!players.has(opponentId)) {
            socket.emit('error', 'Opponent is not connected');
            return;
        }

        socket.emit('rematchSent');
        io.to(opponentId).emit('rematchRequest', {
            requesterId: socket.id,
            requesterName: players.get(socket.id).username
        });
    });

    socket.on('declineRematch', (requesterId) => {
        if (players.has(requesterId)) {
            io.to(requesterId).emit('rematchDeclined');
        }
    });

    socket.on('acceptRematch', (requesterId) => {
        const player = players.get(socket.id);
        const requester = players.get(requesterId);

        if (
            !player ||
            !requester ||
            player.inGame ||
            requester.inGame
        ) {
            return;
        }

        startGame(socket.id, requesterId);
    });

    socket.on('chatMessage', (message) => {
        const player = players.get(socket.id);

        if (!player || typeof message !== 'string') {
            return;
        }

        const cleanMessage = message.trim().slice(0, 500);

        if (!cleanMessage) {
            return;
        }

        io.emit('chatMessage', {
            username: player.username,
            message: cleanMessage,
            timestamp: Date.now()
        });
    });

    socket.on('disconnect', async () => {
        const player = players.get(socket.id);

        if (player) {
            console.log(
                `[DISCONNECT] ${player.username} disconnected`
            );

            activeGames.forEach((game, gameId) => {
                if (
                    game.player1 === socket.id ||
                    game.player2 === socket.id
                ) {
                    const opponentId =
                        game.player1 === socket.id
                            ? game.player2
                            : game.player1;

                    io.to(opponentId).emit(
                        'opponentDisconnected'
                    );

                    const opponent = players.get(opponentId);

                    if (opponent) {
                        opponent.inGame = false;
                    }

                    activeGames.delete(gameId);
                }
            });

            players.delete(socket.id);

            if (waitingPlayer === socket.id) {
                waitingPlayer = null;
            }
        }

        await broadcastLobbyUpdate();
    });
});

function startGame(player1Id, player2Id) {
    const player1 = players.get(player1Id);
    const player2 = players.get(player2Id);

    if (
        !player1 ||
        !player2 ||
        player1.inGame ||
        player2.inGame
    ) {
        return;
    }

    const gameId = `game_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;

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
        gameId,
        opponent: player2.username,
        symbol: 'X',
        yourTurn: true
    });

    io.to(player2Id).emit('gameStart', {
        gameId,
        opponent: player1.username,
        symbol: 'O',
        yourTurn: false
    });

    broadcastGameState(gameId);
    broadcastLobbyUpdate();

    console.log(
        `[GAME START] ${player1.username} vs ${player2.username}`
    );
}

function broadcastGameState(gameId) {
    const game = activeGames.get(gameId);

    if (!game) {
        return;
    }

    const gameState = {
        finished: game.finished,
        board: game.board,
        currentTurn: game.currentTurn,
        player1Name: game.player1Name,
        player2Name: game.player2Name
    };

    io.to(game.player1).emit('gameUpdate', gameState);
    io.to(game.player2).emit('gameUpdate', gameState);
}

function checkWinner(board) {
    const winningLines = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6]
    ];

    for (const [a, b, c] of winningLines) {
        if (
            board[a] &&
            board[a] === board[b] &&
            board[a] === board[c]
        ) {
            return board[a];
        }
    }

    return null;
}

async function endGame(gameId, winnerId, result) {
    const game = activeGames.get(gameId);

    if (!game || game.finished) {
        return;
    }

    game.finished = true;
    broadcastGameState(gameId);

    const player1 = players.get(game.player1);
    const player2 = players.get(game.player2);

    if (player1) {
        player1.inGame = false;
    }

    if (player2) {
        player2.inGame = false;
    }

    try {
        if (result === 'win') {
            const winner = players.get(winnerId);

            const loserId =
                winnerId === game.player1
                    ? game.player2
                    : game.player1;

            const loser = players.get(loserId);

            if (winner && loser) {
                if (dbConnected) {
                    await db.saveGame({
                        gameId,
                        player1: {
                            id: game.player1,
                            username: game.player1Name,
                            symbol: 'X'
                        },
                        player2: {
                            id: game.player2,
                            username: game.player2Name,
                            symbol: 'O'
                        },
                        board: game.board,
                        result: 'win',
                        winner: winner.username,
                        loser: loser.username,
                        moves: game.moveCount
                    });

                    const updatedWinner =
                        await db.Player.findOne({
                            username: winner.username
                        });

                    if (updatedWinner) {
                        updatedWinner.stats.wins += 1;
                        updatedWinner.stats.points += 3;
                        updatedWinner.lastLogin = new Date();
                        await updatedWinner.save();
                    }

                    const updatedLoser =
                        await db.Player.findOne({
                            username: loser.username
                        });

                    if (updatedLoser) {
                        updatedLoser.stats.losses += 1;
                        updatedLoser.lastLogin = new Date();
                        await updatedLoser.save();
                    }
                } else {
                    const winnerStats =
                        leaderboard.get(winner.username) || {
                            username: winner.username,
                            wins: 0,
                            losses: 0,
                            draws: 0,
                            points: 0
                        };

                    const loserStats =
                        leaderboard.get(loser.username) || {
                            username: loser.username,
                            wins: 0,
                            losses: 0,
                            draws: 0,
                            points: 0
                        };

                    winnerStats.wins += 1;
                    winnerStats.points += 3;
                    loserStats.losses += 1;

                    leaderboard.set(
                        winner.username,
                        winnerStats
                    );

                    leaderboard.set(
                        loser.username,
                        loserStats
                    );

                    saveLeaderboard();
                }
            }

            io.to(winnerId).emit('gameEnd', {
                result: 'win',
                gameId
            });

            io.to(loserId).emit('gameEnd', {
                result: 'loss',
                gameId
            });
        } else {
            if (player1 && player2) {
                if (dbConnected) {
                    await db.saveGame({
                        gameId,
                        player1: {
                            id: game.player1,
                            username: game.player1Name,
                            symbol: 'X'
                        },
                        player2: {
                            id: game.player2,
                            username: game.player2Name,
                            symbol: 'O'
                        },
                        board: game.board,
                        result: 'draw',
                        winner: null,
                        loser: null,
                        moves: game.moveCount
                    });

                    const updatedPlayer1 =
                        await db.Player.findOne({
                            username: player1.username
                        });

                    if (updatedPlayer1) {
                        updatedPlayer1.stats.draws += 1;
                        updatedPlayer1.stats.points += 1;
                        updatedPlayer1.lastLogin = new Date();
                        await updatedPlayer1.save();
                    }

                    const updatedPlayer2 =
                        await db.Player.findOne({
                            username: player2.username
                        });

                    if (updatedPlayer2) {
                        updatedPlayer2.stats.draws += 1;
                        updatedPlayer2.stats.points += 1;
                        updatedPlayer2.lastLogin = new Date();
                        await updatedPlayer2.save();
                    }
                } else {
                    const stats1 =
                        leaderboard.get(player1.username) || {
                            username: player1.username,
                            wins: 0,
                            losses: 0,
                            draws: 0,
                            points: 0
                        };

                    const stats2 =
                        leaderboard.get(player2.username) || {
                            username: player2.username,
                            wins: 0,
                            losses: 0,
                            draws: 0,
                            points: 0
                        };

                    stats1.draws += 1;
                    stats1.points += 1;
                    stats2.draws += 1;
                    stats2.points += 1;

                    leaderboard.set(player1.username, stats1);
                    leaderboard.set(player2.username, stats2);

                    saveLeaderboard();
                }
            }

            io.to(game.player1).emit('gameEnd', {
                result: 'draw',
                gameId
            });

            io.to(game.player2).emit('gameEnd', {
                result: 'draw',
                gameId
            });
        }
    } catch (error) {
        console.error('[END GAME ERROR]', error);
    }

    setTimeout(() => {
        activeGames.delete(gameId);
        broadcastLobbyUpdate();
    }, 1000);

    await broadcastLobbyUpdate();
}

function startTournament(availablePlayers) {
    const shuffledPlayers = [...availablePlayers].sort(
        () => Math.random() - 0.5
    );

    tournamentBracket = [];

    for (let index = 0; index < shuffledPlayers.length; index += 2) {
        if (index + 1 < shuffledPlayers.length) {
            tournamentBracket.push([
                shuffledPlayers[index],
                shuffledPlayers[index + 1]
            ]);
        }
    }

    tournamentBracket.forEach((pair) => {
        startGame(pair[0].id, pair[1].id);
    });

    io.emit('tournamentStart', {
        bracket: tournamentBracket.map((pair) => [
            pair[0].username,
            pair[1].username
        ])
    });

    console.log(
        '[TOURNAMENT] Started with',
        shuffledPlayers.length,
        'players'
    );
}

async function broadcastLobbyUpdate() {
    try {
        const onlinePlayers = Array.from(players.values()).map(
            (player) => ({
                username: player.username,
                inGame: player.inGame
            })
        );

        let sortedLeaderboard = [];

        if (dbConnected) {
            const databaseLeaderboard =
                await db.getLeaderboard(10);

            sortedLeaderboard = databaseLeaderboard.map(
                (player) => ({
                    username: player.username,
                    wins: player.stats.wins,
                    losses: player.stats.losses,
                    draws: player.stats.draws,
                    points: player.stats.points
                })
            );
        } else {
            sortedLeaderboard = Array.from(
                leaderboard.values()
            )
                .sort((a, b) => b.points - a.points)
                .slice(0, 10);
        }

        io.emit('lobbyUpdate', {
            players: onlinePlayers,
            leaderboard: sortedLeaderboard,
            activeGames: activeGames.size
        });
    } catch (error) {
        console.error('[LOBBY UPDATE ERROR]', error);
    }
}

async function startServer() {
    await initDatabase();

    http.listen(PORT, '0.0.0.0', () => {
        console.log('='.repeat(60));
        console.log('>> TIC-TAC-TOE TOURNAMENT SERVER');
        console.log(`>> Server running on port ${PORT}`);
        console.log(`>> Local: http://localhost:${PORT}`);
        console.log('='.repeat(60));
    });
}

startServer().catch((error) => {
    console.error('[SERVER ERROR]', error);
    process.exit(1);
});
