# PiTunnel Server (ptserver)

PiTunnel server is a tunnel server that exposes services on your local network to the internet.

## Features

- **Web Tunnel**: HTTP/HTTPS traffic proxying
- **TCP Tunnel**: SSH, RDP, MySQL, PostgreSQL and other protocols
- **WebSocket Support**: Full bidirectional WebSocket proxy (including HMR support)
- **Dynamic Port**: Automatic port opening based on client's target port
- **API**: RESTful API for tunnel management
- **Statistics**: Request count, bandwidth usage

## Quick Install (Recommended)

One-line installer for Linux servers (Ubuntu, Debian, CentOS, etc.):

```bash
curl -fsSL https://raw.githubusercontent.com/Pi-Tunnel/Server/refs/heads/main/setup.sh -o /tmp/setup.sh && sudo bash /tmp/setup.sh
```

This will:
- Install Node.js and dependencies
- Download and configure PiTunnel Server
- Set up systemd service (auto-start on boot)
- Configure firewall rules
- Generate authentication token

## Manual Installation

```bash
# Install globally from npm
npm install -g ptserver
```

## Configuration

Create a `config.json` file:

```json
{
  "domain": "tunnel.example.com",
  "httpPort": 80,
  "wsPort": 8081,
  "apiPort": 8082,
  "authToken": "your-secret-token-here"
}
```

### Configuration Options

| Parameter | Default | Description |
|-----------|---------|-------------|
| `domain` | tunnel.example.com | Main domain for tunnel access |
| `httpPort` | 80 | Port for HTTP traffic |
| `wsPort` | 8081 | Port for WebSocket connections |
| `apiPort` | 8082 | Port for API endpoints |
| `authToken` | null | Client authentication token |

## Running

```bash
ptserver
```

### Install as System Service

Install PiTunnel Server to run automatically on system boot:

```bash
# Linux (requires sudo)
sudo ptserver install

# macOS (requires sudo)
sudo ptserver install

# Windows (run as Administrator)
ptserver install
```

### Uninstall System Service

```bash
# Linux
sudo ptserver uninstall

# macOS
sudo ptserver uninstall

# Windows (run as Administrator)
ptserver uninstall
```

### Platform Support

| Platform | Method | Service Name |
|----------|--------|--------------|
| Linux | systemd | pitunnel-server.service |
| macOS | LaunchDaemon | com.pitunnel.server |
| Windows | Task Scheduler | PiTunnelServer |

### Running with PM2 (alternative)

```bash
pm2 start $(which ptserver) --name pitunnel
pm2 save
pm2 startup
```

## Dynamic Port System

The server automatically starts listening on the client's target port. This enables Hot Module Replacement (HMR) for frameworks like React, Vite, and Next.js to work automatically.

**Example:**
- Client starts a tunnel with target `127.0.0.1:3000`
- Server automatically starts listening on port 3000 as well
- Browser can request `ws://tunnel-name.domain.com:3000/ws`
- Server forwards this request to the client

**Supported Ports:**
- All user ports (1024+)
- 80 and 443 (HTTP/HTTPS)

> **Note:** You may need to allow dynamic ports in your firewall.

## API Reference

All API endpoints (except health) require authentication.

### Authentication

Include one of the following headers with each request:

```
X-Auth-Token: your-token-here
```
or
```
Authorization: Bearer your-token-here
```

---

### GET /health

Server health check. **No token required.**

**Response:**
```json
{
  "status": "ok",
  "uptime": 3600,
  "tunnels": 5,
  "memory": {...},
  "domain": "tunnel.example.com"
}
```

---

### GET /tunnels

Lists all active tunnels.

**Response:**
```json
{
  "tunnels": [
    {
      "name": "my-tunnel",
      "target": "127.0.0.1:3000",
      "tunnelType": "web",
      "protocol": "http",
      "ports": [],
      "connectedAt": "2025-01-01T00:00:00.000Z",
      "uptime": 3600000,
      "stats": {
        "requests": 150,
        "bytesIn": 45000,
        "bytesOut": 1250000
      },
      "accessUrl": "http://my-tunnel.tunnel.example.com"
    }
  ],
  "count": 1
}
```

---

### GET /tunnels/:name

Gets details of a specific tunnel.

**Response:**
```json
{
  "name": "my-tunnel",
  "target": "127.0.0.1:3000",
  "tunnelType": "web",
  "protocol": "http",
  "connectedAt": "2025-01-01T00:00:00.000Z",
  "uptime": 3600000,
  "stats": {
    "requests": 150,
    "bytesIn": 45000,
    "bytesOut": 1250000
  },
  "accessUrl": "http://my-tunnel.tunnel.example.com"
}
```

---

### DELETE /tunnels/:name

Stops a tunnel and closes the client connection.

**Response:**
```json
{
  "success": true,
  "message": "Tunnel my-tunnel stopped"
}
```

---

### POST /tunnels/:name/restart

Sends a restart command to the tunnel.

**Response:**
```json
{
  "success": true,
  "message": "Restart command sent to my-tunnel"
}
```

---

### GET /stats

Gets overall server statistics.

**Response:**
```json
{
  "tunnels": 5,
  "totalRequests": 1500,
  "totalBytesIn": 450000,
  "totalBytesOut": 12500000,
  "uptime": 86400
}
```

---

## Usage Examples

### With cURL

```bash
# List tunnels
curl -H "X-Auth-Token: your-token" http://localhost:8082/tunnels

# Get specific tunnel info
curl -H "X-Auth-Token: your-token" http://localhost:8082/tunnels/my-tunnel

# Stop tunnel
curl -X DELETE -H "X-Auth-Token: your-token" http://localhost:8082/tunnels/my-tunnel

# Restart tunnel
curl -X POST -H "X-Auth-Token: your-token" http://localhost:8082/tunnels/my-tunnel/restart

# Get statistics
curl -H "X-Auth-Token: your-token" http://localhost:8082/stats
```

### With JavaScript

```javascript
const API_URL = 'http://localhost:8082';
const TOKEN = 'your-token';

// Get tunnel list
const response = await fetch(`${API_URL}/tunnels`, {
  headers: { 'X-Auth-Token': TOKEN }
});
const data = await response.json();
console.log(data.tunnels);

// Stop tunnel
await fetch(`${API_URL}/tunnels/my-tunnel`, {
  method: 'DELETE',
  headers: { 'X-Auth-Token': TOKEN }
});
```

### With Python

```python
import requests

API_URL = 'http://localhost:8082'
HEADERS = {'X-Auth-Token': 'your-token'}

# List tunnels
response = requests.get(f'{API_URL}/tunnels', headers=HEADERS)
tunnels = response.json()['tunnels']

# Stop tunnel
requests.delete(f'{API_URL}/tunnels/my-tunnel', headers=HEADERS)
```

## DNS Configuration

Create a wildcard DNS record:

```
*.tunnel.example.com  A  YOUR_SERVER_IP
```

## Firewall Configuration

Open the following ports:

```bash
# Basic ports
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 8081/tcp    # WebSocket
sudo ufw allow 8082/tcp    # API

# Dynamic ports (for HMR support)
sudo ufw allow 3000:9000/tcp   # Common development ports
```

Or to allow all ports:

```bash
sudo ufw disable
# or
sudo ufw default allow incoming
```

## Nginx Reverse Proxy (Optional)

```nginx
server {
    listen 80;
    server_name *.tunnel.example.com;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Security

- **Keep your token secure**: Don't share your token with anyone
- **Use HTTPS**: SSL/TLS is recommended for production
- **Firewall**: Only open necessary ports
- **API access**: API endpoints are protected with token

## License

MIT
