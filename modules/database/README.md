# Database Module

The Database module manages persistent storage for the AI Route Planner using MongoDB Atlas and the Mongoose ODM. It ensures that data integrity is maintained and provides a centralized interface for all persistence operations.

## 🚀 Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env`:
   ```env
   MONGO_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/dbname
   DEBUG=true
   ```
3. Run health check:
   ```bash
   node index.js
   ```

## 🏗️ Architecture

- **ODM**: Uses Mongoose for schema definition and validation.
- **Connection Management**: Robust lifecycle hooks for logging and error reporting.
- **Security**: Automatic credential masking in logs.

## 🛠️ Tech Stack
- **Node.js**: Runtime.
- **Mongoose**: Modeling and validation layer.
- **MongoDB Atlas**: Managed multi-cloud database.

## 🧪 Testing
Run tests from the module directory:
```bash
npm test
```
Or target specific files:
```bash
npm test -- ../../tests/database/mongoConnection.test.js
```
- **Node.js** v18+
- **MongoDB Atlas** cluster (free tier M0 is sufficient for Step 1)
  - See the setup guide at the bottom of this README

## Environment Setup
Edit `modules/database/.env` and replace the placeholder with your Atlas connection string:
```
MONGO_URI=mongodb+srv://username:password@cluster0.abc12.mongodb.net/ai_route_planner?retryWrites=true&w=majority
DEBUG=true
```
> ⚠️ **Never commit a real MONGO_URI to version control.** The `.gitignore` already excludes `.env` files.

## Installation
```bash
cd modules/database
npm install
```

## Running the Health Check
```bash
node index.js
```
Expected output (with a valid Atlas URI):
```
[DATABASE] [INFO]  Initializing...
[DATABASE] [CALL] connectMongo | input: MONGO_URI: mongodb+srv://<credentials>@cluster0.abc12.mongodb.net/...
[DATABASE] [INFO]  Mongoose connected    | host: cluster0.abc12.mongodb.net
[DATABASE] [DONE] connectMongo | output: readyState=1
[DATABASE] [INFO]  Health check PASSED — MongoDB Atlas connection is healthy.
[DATABASE] [CALL] disconnectMongo | input: none
[DATABASE] [INFO]  Mongoose disconnected
[DATABASE] [DONE] disconnectMongo | output: Connection closed
```

## Running Tests
Tests are mocked — no live MongoDB required:
```bash
npm test
```

## Module Structure
```
modules/database/
├── .env                    # MONGO_URI (Atlas connection string), DEBUG
├── package.json
├── index.js                # Health-check entry point
├── module-spec.md          # Module specification and architecture
├── services/
│   └── mongoClient.js      # Mongoose connection + connect/disconnect
└── utils/
    └── logger.js           # [DATABASE]-prefixed logger with CALL/DONE tracing
```

## MongoDB Atlas Quick Setup
1. Create a free account at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Create a **free M0 cluster** (no credit card required)
3. Under **Security → Database Access**: create a database user with Read/Write access
4. Under **Security → Network Access**: add your IP (`0.0.0.0/0` for development)
5. Under **Deployment → Connect**: click "Connect your application" → copy the connection string
6. Replace `<username>`, `<password>`, and `<cluster>` in your `.env` file
