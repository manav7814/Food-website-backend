const http = require("http");
require("dotenv").config({ path: __dirname + "/.env" });
const connectDB = require("./config/db");
const app = require("./app");
const { createSocketServer } = require("./realtime/socket");

// Use consistent port - default to 5000
const PORT = parseInt(process.env.PORT) || 5000;
const MAX_PORT_TRIES = 10;

const startServer = (port) => {
  if (port > 65535 || port - PORT >= MAX_PORT_TRIES) {
    console.error(`Could not find an available port after ${MAX_PORT_TRIES} attempts.`);
    process.exit(1);
  }
  
  const server = http.createServer(app);
  createSocketServer(server, app);
  
  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
  
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use.`);
      const alternatePort = parseInt(port) + 1;
      console.log(`Trying alternate port ${alternatePort}...`);
      startServer(alternatePort);
    } else {
      console.error('Server error:', err);
      server.close();
      process.exit(1);
    }
  });
  
  return server;
};

const server = startServer(PORT);

connectDB().catch(err => {
  console.error('Database connection failed:', err.message);
  server.close();
  process.exit(1);
});
