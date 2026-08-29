# 🗄️ Tic-Tac-Toe Arena - Database Setup Guide

## MongoDB Integration

The application now supports **MongoDB** for persistent data storage with support for:
- ✅ Player Profiles
- ✅ Game History
- ✅ Achievements System
- ✅ Tournament Records
- ✅ Leaderboard Rankings

---

## 🚀 Setup Options

### Option 1: Local MongoDB (Easiest)

#### Step 1: Install MongoDB Community Edition
- **Windows**: Download from https://www.mongodb.com/try/download/community
- **Mac**: `brew install mongodb-community`
- **Linux**: `sudo apt-get install mongodb`

#### Step 2: Start MongoDB Service
```bash
# Windows - Run MongoDB as service
mongod

# Or start in terminal
mongod --dbpath "C:\data\db"

# Mac/Linux
brew services start mongodb-community
# or
mongod
```

#### Step 3: Verify Connection
```bash
mongo
# or
mongosh
```

### Option 2: MongoDB Atlas (Cloud - Free Tier Available)

#### Step 1: Create Free Account
- Go to https://www.mongodb.com/cloud/atlas
- Sign up for free account
- Create a new project

#### Step 2: Create a Cluster
- Click "Create a Cluster"
- Choose Free tier (M0)
- Select your region
- Wait for cluster to deploy (~5-10 minutes)

#### Step 3: Get Connection String
```
In Atlas Dashboard:
1. Click "Connect" button
2. Choose "Connect your application"
3. Copy Connection String
4. Replace <username> and <password>

Example:
mongodb+srv://youruser:yourpass@cluster.mongodb.net/tictactoe-arena
```

#### Step 4: Add IP to Whitelist
- In Atlas, go to "Security" → "Network Access"
- Add IP Address (or 0.0.0.0/0 for development)

---

## 📝 Configuration

### Edit `.env` file

```env
# For Local MongoDB
MONGODB_URI=mongodb://localhost:27017/tictactoe-arena

# For MongoDB Atlas
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/tictactoe-arena

PORT=3001
NODE_ENV=development
```

---

## 📊 Database Schemas

### Player Collection
```javascript
{
  username: String,
  email: String,
  joinedAt: Date,
  lastLogin: Date,
  stats: {
    wins: Number,
    losses: Number,
    draws: Number,
    points: Number
  },
  achievements: [String]
}
```

### Game Collection
```javascript
{
  gameId: String,
  player1: { id, username, symbol },
  player2: { id, username, symbol },
  board: [String],
  result: "win" | "loss" | "draw",
  winner: String,
  loser: String,
  duration: Number,
  moves: Number,
  playedAt: Date
}
```

### Achievement Collection
```javascript
{
  name: String,
  description: String,
  icon: String,
  requirement: String,
  unlockedBy: [String],
  createdAt: Date
}
```

### Tournament Collection
```javascript
{
  tournamentId: String,
  name: String,
  status: "pending" | "ongoing" | "completed",
  participants: [{ username, joined }],
  bracket: Array,
  winner: String,
  startedAt: Date,
  completedAt: Date,
  prizes: String
}
```

---

## 🔧 API Methods Available

### Player Operations
```javascript
await db.createPlayer(username)           // Create new player
await db.getPlayer(username)              // Get player by username
await db.updatePlayerStats(username, stats) // Update stats
await db.getAllPlayers()                  // Get all players
await db.getLeaderboard(limit=10)         // Get top players
```

### Game Operations
```javascript
await db.saveGame(gameData)               // Save game record
await db.getGameHistory(username, limit)  // Get player's games
```

### Achievement Operations
```javascript
await db.grantAchievement(username, name) // Grant achievement
await db.getAllAchievements()             // Get all achievements
```

### Tournament Operations
```javascript
await db.createTournament(data)           // Create tournament
await db.getTournaments(status, limit)    // Get tournaments
```

---

## ✅ Verification

### Check if MongoDB is Working

1. **Start Server**
```bash
npm start
```

2. **Look for this in terminal:**
```
[INIT] Connecting to MongoDB...
[INIT] MongoDB connected - using database storage
```

3. **Test by playing a game**
   - The game results should be saved automatically
   - Leaderboard should update from database

### Verify Data in MongoDB

```bash
# Connect to MongoDB
mongosh

# Or use MongoDB Compass (GUI)
# Download from: https://www.mongodb.com/products/compass
```

---

## 🔄 Fallback to JSON (if MongoDB unavailable)

If MongoDB connection fails, the server automatically falls back to JSON file storage:
- Data saved to `leaderboard.json`
- All functionality works the same
- You can reconnect MongoDB anytime

**Console message:**
```
[INIT] Connecting to MongoDB...
[INIT] Using local JSON storage fallback
```

---

## 🐛 Troubleshooting

### MongoDB Connection Error
```
[DB ERROR] MongoDB connection failed: connect ECONNREFUSED
```
**Solution:**
- Check if MongoDB is running
- Verify connection string in `.env`
- For Atlas, check network whitelist

### Empty Leaderboard
**Solution:**
- Clear the `leaderboard.json` file
- Make sure players play games to populate database

### Port Already in Use
```bash
# Kill existing process
netstat -ano | findstr :3001
taskkill /PID <PID> /F
```

---

## 📦 Production Deployment

### For Heroku / Cloud Deployment

1. **Set Environment Variables**
   ```
   MONGODB_URI = mongodb+srv://...
   NODE_ENV = production
   ```

2. **Use MongoDB Atlas** (recommended for cloud)

3. **Deploy**
   ```bash
   git push heroku main
   ```

---

## 🚀 Next Steps

- [ ] Add user authentication (login/password)
- [ ] Create admin dashboard
- [ ] Implement achievements rewards
- [ ] Add tournament brackets UI
- [ ] Create player profile pages
- [ ] Add statistics charts

---

**Happy Gaming! 🎮**
