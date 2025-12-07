#!/usr/bin/env node

import { WebSocketServer, WebSocket } from 'ws';
import net from 'net';
import http from 'http';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { homedir, platform } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Platform detection
const isWindows = platform() === 'win32';
const isMac = platform() === 'darwin';
const isLinux = platform() === 'linux';

// Check for commands
const command = process.argv[2];
if (command === 'install') {
  installService();
  process.exit(0);
}
if (command === 'uninstall') {
  uninstallService();
  process.exit(0);
}
if (command === 'start') {
  startService();
  process.exit(0);
}
if (command === 'stop') {
  stopService();
  process.exit(0);
}
if (command === 'status') {
  showStatus();
  process.exit(0);
}

// Load settings from config file or environment
let CONFIG = {
  HTTP_PORT: parseInt(process.env.HTTP_PORT) || 80,
  WS_PORT: parseInt(process.env.WS_PORT) || 8081,
  API_PORT: parseInt(process.env.API_PORT) || 8082,
  DOMAIN: process.env.DOMAIN || 'tunnel.example.com',
  AUTH_TOKEN: process.env.AUTH_TOKEN || null,
};

// Read config file if exists
if (existsSync('./config.json')) {
  try {
    const configFile = JSON.parse(readFileSync('./config.json', 'utf8'));
    CONFIG = { ...CONFIG, ...configFile };
    CONFIG.HTTP_PORT = configFile.httpPort || CONFIG.HTTP_PORT;
    CONFIG.WS_PORT = configFile.wsPort || CONFIG.WS_PORT;
    CONFIG.API_PORT = configFile.apiPort || CONFIG.API_PORT;
    CONFIG.DOMAIN = configFile.domain || CONFIG.DOMAIN;
    CONFIG.AUTH_TOKEN = configFile.authToken || CONFIG.AUTH_TOKEN;
  } catch (e) {
    console.log('⚠ Could not read config file, using default settings');
  }
}

// Statistics
const stats = {
  totalRequests: 0,
  totalBytesUp: 0,
  totalBytesDown: 0,
  startTime: Date.now(),
};

// Active tunnels: { tunnelName: { ws, targetHost, tcpServers: Map<port, server> } }
const tunnels = new Map();

// Port → Tunnel mapping
const portToTunnel = new Map();

// Pending requests: requestId → { socket, type }
const pendingRequests = new Map();

// Error page HTML - load from file or use inline
let inactivePageTemplate = null;
let errorPageTemplate = null;

function loadPageTemplates() {
  try {
    inactivePageTemplate = readFileSync('./pages/tunnel-inactive.html', 'utf8');
    errorPageTemplate = readFileSync('./pages/tunnel-error.html', 'utf8');
    console.log('✅ Page templates loaded from files');
  } catch (e) {
    console.log('⚠ Page templates not found, using inline');
  }
}

function getErrorPage(tunnelName, host) {
  if (inactivePageTemplate) {
    return inactivePageTemplate
      .replace(/\{\{TUNNEL_NAME\}\}/g, tunnelName)
      .replace(/\{\{HOST\}\}/g, host)
      .replace(/\{\{TIMESTAMP\}\}/g, new Date().toISOString());
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tunnel Offline - PiTunnel</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
        }
        .container { text-align: center; padding: 40px; max-width: 600px; }
        .error-code { font-size: 72px; font-weight: 800; color: #e94560; margin-bottom: 10px; text-shadow: 0 0 30px rgba(233, 69, 96, 0.5); }
        .error-title { font-size: 24px; font-weight: 600; margin-bottom: 20px; color: #fff; }
        .tunnel-name { display: inline-block; background: rgba(233, 69, 96, 0.2); border: 1px solid #e94560; padding: 8px 16px; border-radius: 6px; font-family: 'Monaco', 'Consolas', monospace; font-size: 14px; color: #e94560; margin-bottom: 30px; }
        .error-message { font-size: 16px; color: #a0a0a0; line-height: 1.6; margin-bottom: 30px; }
        .status-box { background: rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 20px; margin-bottom: 30px; }
        .status-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
        .status-row:last-child { border-bottom: none; }
        .status-label { color: #a0a0a0; font-size: 14px; }
        .status-value { font-weight: 600; font-size: 14px; }
        .status-value.online { color: #4ade80; }
        .status-value.offline { color: #e94560; }
        .retry-btn { display: inline-block; background: linear-gradient(135deg, #e94560 0%, #c23152 100%); color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; transition: all 0.3s ease; border: none; cursor: pointer; }
        .retry-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(233, 69, 96, 0.4); }
        .footer { margin-top: 40px; color: #666; font-size: 12px; }
        .footer a { color: #e94560; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-code">502</div>
        <h1 class="error-title">Tunnel Offline</h1>
        <div class="tunnel-name">${host}</div>
        <p class="error-message">The tunnel <strong>${tunnelName}</strong> is currently not connected to the PiTunnel network. This could mean the client device is offline or hasn't established a connection yet.</p>
        <div class="status-box">
            <div class="status-row"><span class="status-label">PiTunnel Edge</span><span class="status-value online">Connected</span></div>
            <div class="status-row"><span class="status-label">Tunnel: ${tunnelName}</span><span class="status-value offline">Offline</span></div>
            <div class="status-row"><span class="status-label">Origin Server</span><span class="status-value offline">Unreachable</span></div>
        </div>
        <button class="retry-btn" onclick="location.reload()">Try Again</button>
        <div class="footer">Powered by <a href="#">PiTunnel</a> &bull; ${new Date().toISOString()}</div>
    </div>
</body>
</html>`;
}

// Tunnel error page (bağlantı hatası)
function getTunnelErrorPage(tunnelName, host, errorMessage) {
  if (errorPageTemplate) {
    return errorPageTemplate
      .replace(/\{\{TUNNEL_NAME\}\}/g, tunnelName)
      .replace(/\{\{HOST\}\}/g, host)
      .replace(/\{\{ERROR_MESSAGE\}\}/g, errorMessage);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Connection Error - PiTunnel</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
        }
        .container { text-align: center; padding: 40px; max-width: 600px; }
        .error-code { font-size: 72px; font-weight: 800; color: #f59e0b; margin-bottom: 10px; }
        .error-title { font-size: 24px; margin-bottom: 20px; }
        .error-message { color: #a0a0a0; margin-bottom: 20px; }
        .error-detail { background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; font-family: monospace; font-size: 14px; color: #f59e0b; }
        .retry-btn { display: inline-block; background: #f59e0b; color: #000; padding: 14px 32px; border-radius: 8px; font-weight: 600; border: none; cursor: pointer; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-code">503</div>
        <h1 class="error-title">Origin Connection Failed</h1>
        <p class="error-message">The tunnel <strong>${tunnelName}</strong> is online but couldn't connect to the origin server.</p>
        <div class="error-detail">${errorMessage}</div>
        <button class="retry-btn" onclick="location.reload()">Try Again</button>
    </div>
</body>
</html>`;
}

console.log('🚀 PiTunnel Server Starting...');
console.log(`📋 Config: HTTP=${CONFIG.HTTP_PORT}, WS=${CONFIG.WS_PORT}, Domain=${CONFIG.DOMAIN}`);

// Load page templates
loadPageTemplates();

// ==================== Main HTTP Server (Port 80) ====================
const mainServer = http.createServer((req, res) => {
  const host = req.headers.host || '';
  const url = req.url || '/';

  // API endpoints
  if (host.startsWith('api.') || url.startsWith('/api/')) {
    handleApiRequest(req, res);
    return;
  }

  // WebSocket upgrade check (client connections)
  if (url === '/ws' || url.startsWith('/ws/')) {
    // This is a normal HTTP request, not an upgrade - return 426
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('WebSocket connection required');
    return;
  }

  // Tunnel request
  handleTunnelRequest(req, res, host);
});

// WebSocket server - on the same HTTP server
const wss = new WebSocketServer({ noServer: true });

// HTTP upgrade handler
mainServer.on('upgrade', (req, socket, head) => {
  let host = req.headers.host || '';
  const url = req.url || '/';

  // Extract port
  let requestPort = 80;
  if (host.includes(':')) {
    const parts = host.split(':');
    host = parts[0];
    requestPort = parseInt(parts[1]) || 80;
  }

  // Client WebSocket connection (/ws endpoint) - only for main domain
  const isMainDomain = host === CONFIG.DOMAIN || !host.endsWith(`.${CONFIG.DOMAIN}`);
  if ((url === '/ws' || url.startsWith('/ws/')) && isMainDomain && requestPort === CONFIG.WS_PORT) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
    return;
  }

  // WebSocket proxy through tunnel
  let tunnelName = host.split('.')[0];
  let tunnel = tunnels.get(tunnelName);

  // If tunnel not found and port is not 80, search for tunnel with that port
  if (!tunnel && requestPort !== 80) {
    tunnels.forEach((t, name) => {
      if (t.targetPort === requestPort && tunnelName === name) {
        tunnel = t;
      }
    });
  }

  if (!tunnel) {
    socket.destroy();
    return;
  }

  const requestId = randomUUID();
  pendingRequests.set(requestId, { socket, type: 'upgrade', head, tunnel });

  // Forward data from browser to client
  socket.on('data', (data) => {
    if (tunnel.ws.readyState === WebSocket.OPEN) {
      tunnel.ws.send(JSON.stringify({
        type: 'data',
        requestId,
        data: data.toString('base64'),
      }));
    }
  });

  socket.on('end', () => {
    tunnel.ws.send(JSON.stringify({ type: 'end', requestId }));
    pendingRequests.delete(requestId);
  });

  socket.on('error', (err) => {
    tunnel.ws.send(JSON.stringify({ type: 'error', requestId, message: err.message }));
    pendingRequests.delete(requestId);
  });

  // Fix headers - set host to local target
  const modifiedHeaders = { ...req.headers };
  modifiedHeaders.host = `${tunnel.targetHost}:${tunnel.targetPort}`;

  tunnel.ws.send(JSON.stringify({
    type: 'http-upgrade',
    requestId,
    method: req.method,
    url: req.url,
    headers: modifiedHeaders,
  }));
});

// ==================== WebSocket Client Connections ====================
wss.on('connection', (ws, req) => {
  // Get client IP address
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress?.replace('::ffff:', '')
    || 'unknown';

  console.log(`📡 New client connection from ${clientIP}`);

  let tunnelName = null;
  let authenticated = false;
  let clientInfo = { ip: clientIP };

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      // Token validation
      if (msg.type === 'auth') {
        if (CONFIG.AUTH_TOKEN && msg.token !== CONFIG.AUTH_TOKEN) {
          ws.send(JSON.stringify({ type: 'auth-failed', message: 'Invalid token' }));
          ws.close();
          return;
        }
        authenticated = true;
        ws.send(JSON.stringify({
          type: 'auth-success',
          domain: CONFIG.DOMAIN,
          wsPort: CONFIG.WS_PORT,
        }));
        return;
      }

      // Token check (if auth required)
      if (CONFIG.AUTH_TOKEN && !authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
        ws.close();
        return;
      }

      switch (msg.type) {
        case 'register':
          tunnelName = msg.name;
          const targetHost = msg.target || 'localhost';
          const tunnelType = msg.tunnelType || 'web'; // web or tcp
          const protocol = msg.protocol || 'http'; // http, ssh, rdp, mysql, postgresql, ftp, sip

          // Get client device info
          if (msg.deviceInfo) {
            clientInfo = {
              ...clientInfo,
              hostname: msg.deviceInfo.hostname,
              platform: msg.deviceInfo.platform,
              arch: msg.deviceInfo.arch,
              nodeVersion: msg.deviceInfo.nodeVersion,
              osVersion: msg.deviceInfo.osVersion,
              username: msg.deviceInfo.username,
              deviceType: msg.deviceInfo.deviceType,
            };
          }

          if (tunnels.has(tunnelName)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Tunnel name already in use' }));
            ws.close();
            return;
          }

          tunnels.set(tunnelName, {
            ws,
            targetHost,
            targetPort: msg.targetPort || 80,
            tunnelType,
            protocol,
            tcpServers: new Map(),
            connectedAt: new Date(),
            clientInfo,
            stats: {
              requests: 0,
              bytesIn: 0,
              bytesOut: 0,
            }
          });

          console.log(`✅ Tunnel registered: ${tunnelName} (${tunnelType}/${protocol}) → ${targetHost}:${msg.targetPort || 80}`);

          // Start dynamic port server for web tunnels (for HMR support)
          const targetPort = msg.targetPort || 80;
          if (tunnelType === 'web' && targetPort !== 80 && targetPort !== 443) {
            createDynamicPortServer(targetPort);
          }

          // Prepare access URLs
          let accessUrl = '';
          if (tunnelType === 'web') {
            accessUrl = `http://${tunnelName}.${CONFIG.DOMAIN}`;
          } else {
            accessUrl = `${tunnelName}.tcp.${CONFIG.DOMAIN}`;
          }

          ws.send(JSON.stringify({
            type: 'registered',
            name: tunnelName,
            tunnelType,
            protocol,
            accessUrl,
            message: `Tunnel ${tunnelName} active.`
          }));
          break;

        case 'tcp-listen':
          handleTcpListen(tunnelName, msg.port);
          break;

        case 'data':
          handleClientData(msg.requestId, msg.data);
          break;

        case 'end':
          handleClientEnd(msg.requestId);
          break;

        case 'error':
          handleClientError(msg.requestId, msg.message);
          break;
      }
    } catch (err) {
      console.error('Message parse error:', err);
    }
  });

  ws.on('close', () => {
    if (tunnelName && tunnels.has(tunnelName)) {
      const tunnel = tunnels.get(tunnelName);
      const closedPort = tunnel.targetPort;

      tunnel.tcpServers.forEach((server, port) => {
        server.close();
        portToTunnel.delete(port);
      });

      tunnels.delete(tunnelName);
      console.log(`❌ Tunnel disconnected: ${tunnelName}`);

      // Close dynamic server if no other tunnel uses this port
      let portStillUsed = false;
      tunnels.forEach((t) => {
        if (t.targetPort === closedPort) {
          portStillUsed = true;
        }
      });

      if (!portStillUsed) {
        removeDynamicPortServer(closedPort);
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  // Ping/Pong for keepalive
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Keepalive interval
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ==================== Tunnel HTTP Request Handler ====================
function handleTunnelRequest(req, res, host) {
  // Extract port
  let requestPort = 80;
  if (host.includes(':')) {
    const parts = host.split(':');
    host = parts[0];
    requestPort = parseInt(parts[1]) || 80;
  }

  // test1.tunnel.domain.com or test1.tcp.tunnel.domain.com
  let tunnelName = host.split('.')[0];

  // tcp subdomain check: test1.tcp.tunnel... → test1
  if (host.includes('.tcp.')) {
    tunnelName = host.split('.')[0];
  }

  let tunnel = tunnels.get(tunnelName);

  // If tunnel not found and port is not 80, search for tunnel with that port
  if (!tunnel && requestPort !== 80) {
    tunnels.forEach((t, name) => {
      if (t.targetPort === requestPort && host.includes(name)) {
        tunnel = t;
        tunnelName = name;
      }
    });
  }

  // If still not found, try subdomain + port match
  if (!tunnel && requestPort !== 80) {
    tunnels.forEach((t, name) => {
      if (t.targetPort === requestPort && tunnelName === name) {
        tunnel = t;
      }
    });
  }

  if (!tunnel) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getErrorPage(tunnelName, host));
    return;
  }

  const requestId = randomUUID();

  // Update statistics
  tunnel.stats.requests++;

  let body = [];
  req.on('data', chunk => {
    body.push(chunk);
  });
  req.on('end', () => {
    const bodyBuffer = Buffer.concat(body);

    // Calculate request size (headers + body)
    const headersStr = JSON.stringify(req.headers);
    tunnel.stats.bytesIn += headersStr.length + bodyBuffer.length;

    pendingRequests.set(requestId, { res, type: 'http', tunnel });

    tunnel.ws.send(JSON.stringify({
      type: 'http-request',
      requestId,
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: bodyBuffer.toString('base64'),
    }));
  });

  // Timeout
  req.setTimeout(30000, () => {
    if (pendingRequests.has(requestId)) {
      pendingRequests.delete(requestId);
      res.writeHead(504, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getTunnelErrorPage(tunnelName, host, 'Request timeout - origin server did not respond'));
    }
  });
}

// ==================== API Handler ====================
function handleApiRequest(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token');

  // OPTIONS request (CORS preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Token authentication - health endpoint hariç hepsi için gerekli
  const url = req.url.replace('/api', '').split('?')[0];
  const token = req.headers['x-auth-token'] || req.headers['authorization']?.replace('Bearer ', '');

  if (url !== '/health' && url !== '/health/') {
    if (CONFIG.AUTH_TOKEN && token !== CONFIG.AUTH_TOKEN) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized', message: 'Valid token required' }));
      return;
    }
  }

  // GET /tunnels - List all active tunnels
  if ((url === '/tunnels' || url === '/tunnels/') && req.method === 'GET') {
    const list = [];
    tunnels.forEach((tunnel, name) => {
      list.push({
        name,
        target: `${tunnel.targetHost}:${tunnel.targetPort}`,
        tunnelType: tunnel.tunnelType,
        protocol: tunnel.protocol,
        ports: Array.from(tunnel.tcpServers.keys()),
        connectedAt: tunnel.connectedAt,
        uptime: Date.now() - new Date(tunnel.connectedAt).getTime(),
        stats: tunnel.stats,
        clientInfo: tunnel.clientInfo || {},
        accessUrl: tunnel.tunnelType === 'web'
          ? `http://${name}.${CONFIG.DOMAIN}`
          : `${name}.tcp.${CONFIG.DOMAIN}`,
      });
    });
    res.end(JSON.stringify({ tunnels: list, count: list.length }));
    return;
  }

  // GET /health - Server health check (no token required)
  if ((url === '/health' || url === '/health/') && req.method === 'GET') {
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      tunnels: tunnels.size,
      memory: process.memoryUsage(),
      domain: CONFIG.DOMAIN,
    }));
    return;
  }

  // GET /tunnels/:name - Get specific tunnel info
  if (url.startsWith('/tunnels/') && req.method === 'GET') {
    const tunnelName = url.replace('/tunnels/', '').replace('/', '');
    const tunnel = tunnels.get(tunnelName);
    if (tunnel) {
      res.end(JSON.stringify({
        name: tunnelName,
        target: `${tunnel.targetHost}:${tunnel.targetPort}`,
        tunnelType: tunnel.tunnelType,
        protocol: tunnel.protocol,
        connectedAt: tunnel.connectedAt,
        uptime: Date.now() - new Date(tunnel.connectedAt).getTime(),
        stats: tunnel.stats,
        clientInfo: tunnel.clientInfo || {},
        accessUrl: tunnel.tunnelType === 'web'
          ? `http://${tunnelName}.${CONFIG.DOMAIN}`
          : `${tunnelName}.tcp.${CONFIG.DOMAIN}`,
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Tunnel not found' }));
    }
    return;
  }

  // DELETE /tunnels/:name - Stop/delete tunnel
  if (url.startsWith('/tunnels/') && req.method === 'DELETE') {
    const tunnelName = url.replace('/tunnels/', '').replace('/', '');
    const tunnel = tunnels.get(tunnelName);
    if (tunnel) {
      // Send stop command to client
      tunnel.ws.send(JSON.stringify({ type: 'command', action: 'stop', reason: 'API request' }));
      // Close WebSocket
      tunnel.ws.close();
      res.end(JSON.stringify({ success: true, message: `Tunnel ${tunnelName} stopped` }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Tunnel not found' }));
    }
    return;
  }

  // POST /tunnels/:name/restart - Restart tunnel
  if (url.match(/^\/tunnels\/[^/]+\/restart\/?$/) && req.method === 'POST') {
    const tunnelName = url.replace('/tunnels/', '').replace('/restart', '').replace('/', '');
    const tunnel = tunnels.get(tunnelName);
    if (tunnel) {
      // Send restart command to client
      tunnel.ws.send(JSON.stringify({ type: 'command', action: 'restart', reason: 'API request' }));
      res.end(JSON.stringify({ success: true, message: `Restart command sent to ${tunnelName}` }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Tunnel not found' }));
    }
    return;
  }

  // GET /stats - General statistics
  if ((url === '/stats' || url === '/stats/') && req.method === 'GET') {
    let totalRequests = 0;
    let totalBytesIn = 0;
    let totalBytesOut = 0;

    tunnels.forEach(tunnel => {
      totalRequests += tunnel.stats.requests;
      totalBytesIn += tunnel.stats.bytesIn;
      totalBytesOut += tunnel.stats.bytesOut;
    });

    res.end(JSON.stringify({
      tunnels: tunnels.size,
      totalRequests,
      totalBytesIn,
      totalBytesOut,
      uptime: process.uptime(),
    }));
    return;
  }

  // 404 - Endpoint not found
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

// ==================== TCP Port Handler ====================
function handleTcpListen(tunnelName, port) {
  const tunnel = tunnels.get(tunnelName);
  if (!tunnel) return;

  if (tunnel.tcpServers.has(port)) {
    tunnel.ws.send(JSON.stringify({ type: 'tcp-listening', port, status: 'already' }));
    return;
  }

  // Block privileged ports
  if (port < 1024 && port !== 80 && port !== 443) {
    tunnel.ws.send(JSON.stringify({ type: 'tcp-error', port, message: 'Privileged port not allowed' }));
    return;
  }

  const tcpServer = net.createServer((socket) => {
    const requestId = randomUUID();

    pendingRequests.set(requestId, {
      socket,
      type: 'tcp',
      tunnelName
    });

    tunnel.ws.send(JSON.stringify({
      type: 'tcp-connect',
      requestId,
      port,
      remoteAddress: socket.remoteAddress,
    }));

    socket.on('data', (data) => {
      if (tunnel.ws.readyState === WebSocket.OPEN) {
        tunnel.ws.send(JSON.stringify({
          type: 'data',
          requestId,
          data: data.toString('base64'),
        }));
      }
    });

    socket.on('end', () => {
      tunnel.ws.send(JSON.stringify({ type: 'end', requestId }));
      pendingRequests.delete(requestId);
    });

    socket.on('error', (err) => {
      tunnel.ws.send(JSON.stringify({ type: 'error', requestId, message: err.message }));
      pendingRequests.delete(requestId);
    });
  });

  tcpServer.listen(port, () => {
    tunnel.tcpServers.set(port, tcpServer);
    portToTunnel.set(port, tunnelName);
    console.log(`🔌 TCP port ${port} listening for tunnel: ${tunnelName}`);
    tunnel.ws.send(JSON.stringify({ type: 'tcp-listening', port, status: 'ok' }));
  });

  tcpServer.on('error', (err) => {
    console.error(`TCP server error on port ${port}:`, err.message);
    tunnel.ws.send(JSON.stringify({ type: 'tcp-error', port, message: err.message }));
  });
}

// ==================== Client Response Handlers ====================
function handleClientData(requestId, base64Data) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;

  const data = Buffer.from(base64Data, 'base64');

  // Update response statistics (bytesOut = data sent from server)
  if (pending.tunnel) {
    pending.tunnel.stats.bytesOut += data.length;
  }

  if (pending.type === 'http') {
    if (!pending.headersSent) {
      const dataStr = data.toString();
      const headerEndIndex = dataStr.indexOf('\r\n\r\n');

      if (headerEndIndex !== -1) {
        const headerPart = dataStr.substring(0, headerEndIndex);
        const bodyPart = data.slice(headerEndIndex + 4);

        const lines = headerPart.split('\r\n');
        const statusLine = lines[0];
        const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)/);
        const statusCode = statusMatch ? parseInt(statusMatch[1]) : 200;

        const headers = {};
        for (let i = 1; i < lines.length; i++) {
          const colonIndex = lines[i].indexOf(':');
          if (colonIndex !== -1) {
            const key = lines[i].substring(0, colonIndex).trim().toLowerCase();
            const value = lines[i].substring(colonIndex + 1).trim();
            if (key !== 'transfer-encoding' && key !== 'connection' && key !== 'keep-alive') {
              headers[key] = value;
            }
          }
        }

        pending.res.writeHead(statusCode, headers);
        pending.headersSent = true;

        if (bodyPart.length > 0) {
          pending.res.write(bodyPart);
        }
      } else {
        pending.buffer = pending.buffer ? Buffer.concat([pending.buffer, data]) : data;
      }
    } else {
      pending.res.write(data);
    }
  } else if (pending.type === 'tcp' || pending.type === 'upgrade') {
    pending.socket.write(data);
  }
}

function handleClientEnd(requestId) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;

  if (pending.type === 'http') {
    pending.res.end();
  } else if (pending.type === 'tcp' || pending.type === 'upgrade') {
    pending.socket.end();
  }

  pendingRequests.delete(requestId);
}

function handleClientError(requestId, message) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;

  if (pending.type === 'http') {
    if (!pending.headersSent) {
      pending.res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      pending.res.end(getTunnelErrorPage('unknown', '', message));
    } else {
      pending.res.end();
    }
  } else if (pending.type === 'tcp' || pending.type === 'upgrade') {
    pending.socket.destroy();
  }

  pendingRequests.delete(requestId);
}

// Dynamic port listeners (for HMR)
const dynamicServers = new Map();

function createDynamicPortServer(port) {
  if (dynamicServers.has(port) || port === CONFIG.HTTP_PORT || port === CONFIG.WS_PORT || port === CONFIG.API_PORT) {
    return;
  }

  const server = http.createServer((req, res) => {
    const host = req.headers.host || '';
    handleTunnelRequest(req, res, host);
  });

  // WebSocket upgrade support
  server.on('upgrade', (req, socket, head) => {
    let host = req.headers.host || '';
    const url = req.url || '/';

    // Extract port - this dynamic server's port
    let requestPort = port;
    if (host.includes(':')) {
      const parts = host.split(':');
      host = parts[0];
      requestPort = parseInt(parts[1]) || port;
    }

    const tunnelName = host.split('.')[0];
    let tunnel = tunnels.get(tunnelName);

    // If tunnel not found, search for tunnel with this port
    if (!tunnel) {
      tunnels.forEach((t, name) => {
        if (t.targetPort === requestPort && tunnelName === name) {
          tunnel = t;
        }
      });
    }

    // If still not found, try port match only
    if (!tunnel) {
      tunnels.forEach((t, name) => {
        if (t.targetPort === requestPort) {
          tunnel = t;
        }
      });
    }

    if (!tunnel) {
      socket.destroy();
      return;
    }

    const requestId = randomUUID();
    pendingRequests.set(requestId, { socket, type: 'upgrade', head, tunnel });

    // Forward data from browser to client
    socket.on('data', (data) => {
      if (tunnel.ws.readyState === WebSocket.OPEN) {
        tunnel.ws.send(JSON.stringify({
          type: 'data',
          requestId,
          data: data.toString('base64'),
        }));
      }
    });

    socket.on('end', () => {
      tunnel.ws.send(JSON.stringify({ type: 'end', requestId }));
      pendingRequests.delete(requestId);
    });

    socket.on('error', (err) => {
      tunnel.ws.send(JSON.stringify({ type: 'error', requestId, message: err.message }));
      pendingRequests.delete(requestId);
    });

    const modifiedHeaders = { ...req.headers };
    modifiedHeaders.host = `${tunnel.targetHost}:${tunnel.targetPort}`;

    tunnel.ws.send(JSON.stringify({
      type: 'http-upgrade',
      requestId,
      method: req.method,
      url: req.url,
      headers: modifiedHeaders,
    }));
  });

  server.listen(port, () => {
    console.log(`🔌 Dynamic HTTP/WS server listening on port ${port}`);
    dynamicServers.set(port, server);
  });

  server.on('error', (err) => {
    // Port may already be in use, skip silently
    if (err.code !== 'EADDRINUSE') {
      console.error(`Dynamic server error on port ${port}:`, err.message);
    }
  });
}

function removeDynamicPortServer(port) {
  const server = dynamicServers.get(port);
  if (server) {
    server.close();
    dynamicServers.delete(port);
    console.log(`🔌 Dynamic server closed on port ${port}`);
  }
}

// ==================== Start Server ====================
mainServer.listen(CONFIG.HTTP_PORT, () => {
  console.log(`🌐 HTTP server listening on port ${CONFIG.HTTP_PORT}`);
});

// Separate WebSocket port (optional - for legacy clients)
if (CONFIG.WS_PORT !== CONFIG.HTTP_PORT) {
  const wsOnlyServer = http.createServer((req, res) => {
    res.writeHead(426);
    res.end('WebSocket connection required. Connect to ws://host:' + CONFIG.WS_PORT);
  });

  const wssLegacy = new WebSocketServer({ server: wsOnlyServer });

  wssLegacy.on('connection', (ws, req) => {
    wss.emit('connection', ws, req);
  });

  wsOnlyServer.listen(CONFIG.WS_PORT, () => {
    console.log(`📡 WebSocket server listening on port ${CONFIG.WS_PORT}`);
  });
}

// Separate API port
const apiServer = http.createServer((req, res) => {
  handleApiRequest(req, res);
});

apiServer.listen(CONFIG.API_PORT, () => {
  console.log(`📊 API server listening on port ${CONFIG.API_PORT}`);
});

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                  🌐 PiTunnel Server                       ║
╠═══════════════════════════════════════════════════════════╣
║  HTTP:      http://0.0.0.0:${String(CONFIG.HTTP_PORT).padEnd(29)}║
║  WebSocket: ws://0.0.0.0:${String(CONFIG.WS_PORT).padEnd(31)}║
║  API:       http://0.0.0.0:${String(CONFIG.API_PORT).padEnd(29)}║
║  Domain:    *.${CONFIG.DOMAIN.padEnd(43)}║
╚═══════════════════════════════════════════════════════════╝

Client connection command:
  pitunnel connect --name TUNNEL_NAME --server ws://IP:${CONFIG.WS_PORT} --target TARGET_IP:PORT
`);

// ==================== Install/Uninstall Service ====================
function installService() {
  console.log('');
  console.log('📦 Installing PiTunnel Server as system service...');

  const nodePath = process.execPath;
  const scriptPath = join(__dirname, 'index.js');
  const workingDir = __dirname;

  if (isWindows) {
    installWindows(nodePath, scriptPath, workingDir);
  } else if (isMac) {
    installMac(nodePath, scriptPath, workingDir);
  } else if (isLinux) {
    installLinux(nodePath, scriptPath, workingDir);
  } else {
    console.log('❌ Unsupported platform');
  }
}

function uninstallService() {
  console.log('');
  console.log('🗑️  Removing PiTunnel Server from system startup...');

  if (isWindows) {
    uninstallWindows();
  } else if (isMac) {
    uninstallMac();
  } else if (isLinux) {
    uninstallLinux();
  } else {
    console.log('❌ Unsupported platform');
  }
}

// Windows Install
function installWindows(nodePath, scriptPath, workingDir) {
  const taskName = 'PiTunnelServer';
  const command = `"${nodePath}" "${scriptPath}"`;

  try {
    // Delete existing task
    try {
      execSync(`schtasks /delete /tn "${taskName}" /f 2>nul`, { stdio: 'pipe' });
    } catch (e) {
      // Task may not exist
    }

    // Create new task - run at system startup with highest privileges
    execSync(`schtasks /create /tn "${taskName}" /tr "${command}" /sc onstart /ru SYSTEM /rl highest /f`, {
      stdio: 'pipe'
    });

    console.log('✅ PiTunnel Server installed successfully!');
    console.log('   Service will start automatically on system boot.');
    console.log('   To start now: node index.js');
    console.log('   To remove: node index.js uninstall');
  } catch (e) {
    console.log(`❌ Installation failed: ${e.message}`);
    console.log('   Try running as Administrator');
  }
}

function uninstallWindows() {
  const taskName = 'PiTunnelServer';

  try {
    execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'pipe' });
    console.log('✅ PiTunnel Server removed from system startup');
  } catch (e) {
    console.log('⚠️  PiTunnel Server was not installed or already removed');
  }
}

// macOS Install
function installMac(nodePath, scriptPath, workingDir) {
  const plistPath = '/Library/LaunchDaemons/com.pitunnel.server.plist';
  const logPath = join(workingDir, 'server.log');

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pitunnel.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${scriptPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${workingDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
</dict>
</plist>`;

  try {
    // Unload existing service
    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'pipe' });
    } catch (e) {}

    // Write plist file (requires sudo)
    writeFileSync(plistPath, plistContent);

    // Set permissions
    execSync(`chmod 644 "${plistPath}"`, { stdio: 'pipe' });

    // Load and start service
    execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });

    console.log('✅ PiTunnel Server installed successfully!');
    console.log('   Service is now running and will start automatically on boot.');
    console.log(`   Log file: ${logPath}`);
    console.log('   To remove: sudo node index.js uninstall');
  } catch (e) {
    console.log(`❌ Installation failed: ${e.message}`);
    console.log('   Try running with sudo: sudo node index.js install');
  }
}

function uninstallMac() {
  const plistPath = '/Library/LaunchDaemons/com.pitunnel.server.plist';

  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'pipe' });
  } catch (e) {}

  try {
    if (existsSync(plistPath)) {
      unlinkSync(plistPath);
      console.log('✅ PiTunnel Server removed from system startup');
    } else {
      console.log('⚠️  PiTunnel Server was not installed or already removed');
    }
  } catch (e) {
    console.log(`❌ Uninstall failed: ${e.message}`);
    console.log('   Try running with sudo: sudo node index.js uninstall');
  }
}

// Linux Install (systemd)
function installLinux(nodePath, scriptPath, workingDir) {
  const servicePath = '/etc/systemd/system/pitunnel.service';
  const logPath = join(workingDir, 'server.log');

  const serviceContent = `[Unit]
Description=PiTunnel Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${workingDir}
ExecStart=${nodePath} ${scriptPath}
Restart=always
RestartSec=10
StandardOutput=append:${logPath}
StandardError=append:${logPath}

[Install]
WantedBy=multi-user.target
`;

  try {
    // Write service file
    writeFileSync(servicePath, serviceContent);

    // Reload systemd daemon
    execSync('systemctl daemon-reload', { stdio: 'pipe' });

    // Enable and start service
    execSync('systemctl enable pitunnel.service', { stdio: 'pipe' });
    execSync('systemctl start pitunnel.service', { stdio: 'pipe' });

    console.log('✅ PiTunnel Server installed successfully!');
    console.log('   Service is now running and will start automatically on boot.');
    console.log(`   Log file: ${logPath}`);
    console.log('   Status: ptserver status');
    console.log('   To remove: sudo ptserver uninstall');
  } catch (e) {
    console.log(`❌ Installation failed: ${e.message}`);
    console.log('   Try running with sudo: sudo ptserver install');
  }
}

function uninstallLinux() {
  const serviceName = findLinuxService();
  const servicePath = serviceName
    ? `/etc/systemd/system/${serviceName}.service`
    : '/etc/systemd/system/pitunnel.service';

  try {
    execSync(`systemctl stop ${serviceName || 'pitunnel'}.service 2>/dev/null`, { stdio: 'pipe' });
    execSync(`systemctl disable ${serviceName || 'pitunnel'}.service 2>/dev/null`, { stdio: 'pipe' });
  } catch (e) {}

  try {
    if (existsSync(servicePath)) {
      unlinkSync(servicePath);
      execSync('systemctl daemon-reload', { stdio: 'pipe' });
      console.log('✅ PiTunnel Server removed from system startup');
    } else {
      console.log('⚠️  PiTunnel Server was not installed or already removed');
    }
  } catch (e) {
    console.log(`❌ Uninstall failed: ${e.message}`);
    console.log('   Try running with sudo: sudo ptserver uninstall');
  }
}

// ==================== Start/Stop/Status Service ====================
function startService() {
  console.log('');
  console.log('🚀 Starting PiTunnel Server...');

  if (isWindows) {
    startWindows();
  } else if (isMac) {
    startMac();
  } else if (isLinux) {
    startLinux();
  } else {
    console.log('❌ Unsupported platform');
  }
}

function stopService() {
  console.log('');
  console.log('🛑 Stopping PiTunnel Server...');

  if (isWindows) {
    stopWindows();
  } else if (isMac) {
    stopMac();
  } else if (isLinux) {
    stopLinux();
  } else {
    console.log('❌ Unsupported platform');
  }
}

function showStatus() {
  console.log('');
  console.log('📊 PiTunnel Server Status');
  console.log('─'.repeat(40));

  if (isWindows) {
    statusWindows();
  } else if (isMac) {
    statusMac();
  } else if (isLinux) {
    statusLinux();
  } else {
    console.log('❌ Unsupported platform');
  }
}

// Windows Start/Stop/Status
function startWindows() {
  const taskName = 'PiTunnelServer';
  try {
    execSync(`schtasks /run /tn "${taskName}"`, { stdio: 'pipe' });
    console.log('✅ PiTunnel Server started');
  } catch (e) {
    console.log('❌ Failed to start PiTunnel Server');
    console.log('   Make sure the service is installed: ptserver install');
  }
}

function stopWindows() {
  const taskName = 'PiTunnelServer';
  try {
    execSync(`taskkill /f /im node.exe /fi "WINDOWTITLE eq PiTunnel*" 2>nul`, { stdio: 'pipe' });
    console.log('✅ PiTunnel Server stopped');
  } catch (e) {
    // Try alternative method
    try {
      execSync(`schtasks /end /tn "${taskName}"`, { stdio: 'pipe' });
      console.log('✅ PiTunnel Server stopped');
    } catch (e2) {
      console.log('⚠️  PiTunnel Server may not be running');
    }
  }
}

function statusWindows() {
  const taskName = 'PiTunnelServer';
  try {
    const result = execSync(`schtasks /query /tn "${taskName}" /fo list`, { encoding: 'utf8' });
    const statusMatch = result.match(/Status:\s+(\w+)/);
    const status = statusMatch ? statusMatch[1] : 'Unknown';

    console.log(`Service:  ${taskName}`);
    console.log(`Status:   ${status === 'Running' ? '🟢 Running' : '🔴 Stopped'}`);
    console.log(`Platform: Windows (Task Scheduler)`);
  } catch (e) {
    console.log('Status:   ⚠️  Not installed');
    console.log('Install:  ptserver install');
  }
}

// macOS Start/Stop/Status
function startMac() {
  const plistPath = '/Library/LaunchDaemons/com.pitunnel.server.plist';
  try {
    execSync(`launchctl load "${plistPath}" 2>/dev/null`, { stdio: 'pipe' });
    execSync(`launchctl start com.pitunnel.server`, { stdio: 'pipe' });
    console.log('✅ PiTunnel Server started');
  } catch (e) {
    console.log('❌ Failed to start PiTunnel Server');
    console.log('   Make sure the service is installed: sudo ptserver install');
  }
}

function stopMac() {
  try {
    execSync(`launchctl stop com.pitunnel.server`, { stdio: 'pipe' });
    console.log('✅ PiTunnel Server stopped');
  } catch (e) {
    console.log('⚠️  PiTunnel Server may not be running');
  }
}

function statusMac() {
  try {
    const result = execSync(`launchctl list | grep com.pitunnel.server`, { encoding: 'utf8' });
    const parts = result.trim().split(/\s+/);
    const pid = parts[0];
    const isRunning = pid !== '-' && pid !== '';

    console.log(`Service:  com.pitunnel.server`);
    console.log(`Status:   ${isRunning ? `🟢 Running (PID: ${pid})` : '🔴 Stopped'}`);
    console.log(`Platform: macOS (LaunchDaemon)`);
  } catch (e) {
    console.log('Status:   ⚠️  Not installed');
    console.log('Install:  sudo ptserver install');
  }
}

// Linux Start/Stop/Status
function findLinuxService() {
  const serviceNames = ['pitunnel', 'pitunnel-server'];
  for (const serviceName of serviceNames) {
    if (existsSync(`/etc/systemd/system/${serviceName}.service`)) {
      return serviceName;
    }
  }
  return null;
}

function startLinux() {
  const serviceName = findLinuxService();
  if (!serviceName) {
    console.log('❌ PiTunnel Server is not installed');
    console.log('   Install with: sudo ptserver install');
    return;
  }

  try {
    execSync(`systemctl start ${serviceName}.service`, { stdio: 'pipe' });
    console.log('✅ PiTunnel Server started');
  } catch (e) {
    console.log('❌ Failed to start PiTunnel Server');
    console.log('   Check logs: journalctl -u ' + serviceName + ' -f');
  }
}

function stopLinux() {
  const serviceName = findLinuxService();
  if (!serviceName) {
    console.log('⚠️  PiTunnel Server is not installed');
    return;
  }

  try {
    execSync(`systemctl stop ${serviceName}.service`, { stdio: 'pipe' });
    console.log('✅ PiTunnel Server stopped');
  } catch (e) {
    console.log('⚠️  PiTunnel Server may not be running');
  }
}

function statusLinux() {
  // Try both service names (pitunnel for setup.sh install, pitunnel-server for npm install)
  const serviceNames = ['pitunnel', 'pitunnel-server'];
  let foundService = null;
  let isRunning = false;

  for (const serviceName of serviceNames) {
    try {
      const result = execSync(`systemctl is-active ${serviceName}.service 2>/dev/null`, { encoding: 'utf8' }).trim();
      if (result === 'active' || result === 'inactive') {
        foundService = serviceName;
        isRunning = result === 'active';
        break;
      }
    } catch (e) {
      // Try next service name
    }
  }

  if (!foundService) {
    // Check if service file exists
    for (const serviceName of serviceNames) {
      if (existsSync(`/etc/systemd/system/${serviceName}.service`)) {
        foundService = serviceName;
        break;
      }
    }
  }

  if (foundService) {
    let pid = '';
    if (isRunning) {
      try {
        const pidResult = execSync(`systemctl show ${foundService}.service --property=MainPID --value`, { encoding: 'utf8' }).trim();
        pid = pidResult;
      } catch (e) {}
    }

    console.log(`Service:  ${foundService}.service`);
    console.log(`Status:   ${isRunning ? `🟢 Running${pid ? ` (PID: ${pid})` : ''}` : '🔴 Stopped'}`);
    console.log(`Platform: Linux (systemd)`);

    // Show more details
    try {
      const enabled = execSync(`systemctl is-enabled ${foundService}.service 2>/dev/null`, { encoding: 'utf8' }).trim();
      console.log(`Enabled:  ${enabled === 'enabled' ? '✅ Yes' : '❌ No'}`);
    } catch (e) {}
  } else {
    console.log('Status:   ⚠️  Not installed');
    console.log('Install:  sudo ptserver install');
  }
}
