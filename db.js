require('dotenv').config();
const mongoose = require('mongoose');

// Player Schema
const playerSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    email: String,
    joinedAt: {
        type: Date,
        default: Date.now
    },
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        draws: { type: Number, default: 0 },
        points: { type: Number, default: 0 }
    },
    achievements: [String],
    lastLogin: Date
});

// Game History Schema
const gameSchema = new mongoose.Schema({
    gameId: String,
    player1: {
        id: String,
        username: String,
        symbol: String
    },
    player2: {
        id: String,
        username: String,
        symbol: String
    },
    board: [String],
    result: {
        type: String,
        enum: ['win', 'loss', 'draw']
    },
    winner: String,
    loser: String,
    duration: Number, // in seconds
    moves: Number,
    playedAt: {
        type: Date,
        default: Date.now
    }
});

// Achievement Schema
const achievementSchema = new mongoose.Schema({
    name: String,
    description: String,
    icon: String,
    requirement: String,
    unlockedBy: [String], // array of usernames
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Tournament Schema
const tournamentSchema = new mongoose.Schema({
    tournamentId: String,
    name: String,
    status: {
        type: String,
        enum: ['pending', 'ongoing', 'completed'],
        default: 'pending'
    },
    participants: [{
        username: String,
        joined: Date
    }],
    bracket: Array,
    winner: String,
    startedAt: Date,
    completedAt: Date,
    prizes: String
});

// Create models
const Player = mongoose.model('Player', playerSchema);
const Game = mongoose.model('Game', gameSchema);
const Achievement = mongoose.model('Achievement', achievementSchema);
const Tournament = mongoose.model('Tournament', tournamentSchema);

// MongoDB Connection
async function connectDB() {
    try {
        // Using MongoDB Atlas or Local MongoDB
        const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tictactoe-arena';
        
        await mongoose.connect(mongoURI);
        
        console.log('[DB] MongoDB connected successfully');
        return true;
    } catch (error) {
        console.error('[DB ERROR] MongoDB connection failed:', error.message);
        console.log('[DB] Falling back to JSON file storage...');
        return false;
    }
}

// Helper Functions
const db = {
    Player,
    Game,
    Achievement,
    Tournament,
    connectDB,

    // Player operations
    async createPlayer(username) {
        try {
            const player = new Player({
                username,
                stats: { wins: 0, losses: 0, draws: 0, points: 0 }
            });
            await player.save();
            return player;
        } catch (error) {
            console.error('[DB] Error creating player:', error);
            return null;
        }
    },

    async getPlayer(username) {
        try {
            return await Player.findOne({ username });
        } catch (error) {
            console.error('[DB] Error getting player:', error);
            return null;
        }
    },

    async updatePlayerStats(username, stats) {
        try {
            return await Player.findOneAndUpdate(
                { username },
                { stats },
                { new: true }
            );
        } catch (error) {
            console.error('[DB] Error updating player stats:', error);
            return null;
        }
    },

    async getAllPlayers() {
        try {
            return await Player.find().sort({ 'stats.points': -1 });
        } catch (error) {
            console.error('[DB] Error getting all players:', error);
            return [];
        }
    },

    async getLeaderboard(limit = 10) {
        try {
            return await Player.find()
                .sort({ 'stats.points': -1 })
                .limit(limit);
        } catch (error) {
            console.error('[DB] Error getting leaderboard:', error);
            return [];
        }
    },

    // Game operations
    async saveGame(gameData) {
        try {
            const game = new Game(gameData);
            await game.save();
            return game;
        } catch (error) {
            console.error('[DB] Error saving game:', error);
            return null;
        }
    },

    async getGameHistory(username, limit = 10) {
        try {
            return await Game.find({
                $or: [
                    { 'player1.username': username },
                    { 'player2.username': username }
                ]
            })
            .sort({ playedAt: -1 })
            .limit(limit);
        } catch (error) {
            console.error('[DB] Error getting game history:', error);
            return [];
        }
    },

    // Achievement operations
    async grantAchievement(username, achievementName) {
        try {
            const player = await Player.findOne({ username });
            if (player && !player.achievements.includes(achievementName)) {
                player.achievements.push(achievementName);
                await player.save();
                
                // Update achievement record
                await Achievement.findOneAndUpdate(
                    { name: achievementName },
                    { $push: { unlockedBy: username } }
                );
                
                return true;
            }
            return false;
        } catch (error) {
            console.error('[DB] Error granting achievement:', error);
            return false;
        }
    },

    async getAllAchievements() {
        try {
            return await Achievement.find();
        } catch (error) {
            console.error('[DB] Error getting achievements:', error);
            return [];
        }
    },

    // Tournament operations
    async createTournament(tournamentData) {
        try {
            const tournament = new Tournament(tournamentData);
            await tournament.save();
            return tournament;
        } catch (error) {
            console.error('[DB] Error creating tournament:', error);
            return null;
        }
    },

    async getTournaments(status = 'ongoing', limit = 10) {
        try {
            return await Tournament.find({ status }).limit(limit);
        } catch (error) {
            console.error('[DB] Error getting tournaments:', error);
            return [];
        }
    }
};

module.exports = db;
