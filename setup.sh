#!/bin/bash

# PiTunnel Server - One-Line Installer
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/Pi-Tunnel/Server/refs/heads/main/setup.sh)
#    or: curl -fsSL https://raw.githubusercontent.com/Pi-Tunnel/Server/refs/heads/main/setup.sh -o setup.sh && sudo bash setup.sh

set -e

# Version
VERSION="1.0.0"
REPO_URL="https://github.com/Pi-Tunnel/Server"
RAW_URL="https://raw.githubusercontent.com/Pi-Tunnel/Server/refs/heads/main"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

# Installation directory
INSTALL_DIR="/opt/pitunnel"
CONFIG_DIR="/etc/pitunnel"
LOG_DIR="/var/log/pitunnel"

# Banner
clear
echo -e "${CYAN}"
cat << "EOF"
    ____  _ ______                       __
   / __ \(_)_  __/_  ______  ____  ___  / /
  / /_/ / / / / / / / / __ \/ __ \/ _ \/ /
 / ____/ / / / / /_/ / / / / / / /  __/ /
/_/   /_/ /_/  \__,_/_/ /_/_/ /_/\___/_/

EOF
echo -e "${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}          PiTunnel Server - One-Line Installer v${VERSION}${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# ==================== Functions ====================
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

spinner() {
    local pid=$1
    local delay=0.1
    local spinstr='|/-\'
    while [ "$(ps a | awk '{print $1}' | grep $pid)" ]; do
        local temp=${spinstr#?}
        printf " [%c]  " "$spinstr"
        local spinstr=$temp${spinstr%"$temp"}
        sleep $delay
        printf "\b\b\b\b\b\b"
    done
    printf "    \b\b\b\b"
}

# ==================== Root Check ====================
if [ "$EUID" -ne 0 ]; then
    echo ""
    log_error "This script must be run as root"
    echo ""
    echo -e "  Run with: ${CYAN}curl -fsSL $RAW_URL/setup.sh | sudo bash${NC}"
    echo ""
    exit 1
fi

# ==================== OS Detection ====================
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        OS_VERSION=$VERSION_ID
        OS_NAME=$NAME
    elif [ -f /etc/redhat-release ]; then
        OS="centos"
        OS_VERSION=$(cat /etc/redhat-release | grep -oE '[0-9]+' | head -1)
        OS_NAME="CentOS"
    else
        OS="unknown"
        OS_VERSION="unknown"
        OS_NAME="Unknown"
    fi
}

# ==================== System Requirements ====================
echo -e "${BOLD}${BLUE}[1/6] Checking System Requirements${NC}"
echo ""

detect_os

# OS Check
case $OS in
    ubuntu|debian|raspbian)
        PKG_MANAGER="apt"
        PKG_UPDATE="apt update -qq"
        PKG_INSTALL="apt install -y -qq"
        ;;
    centos|rhel|rocky|almalinux|fedora)
        PKG_MANAGER="yum"
        if command -v dnf &> /dev/null; then
            PKG_MANAGER="dnf"
        fi
        PKG_UPDATE="$PKG_MANAGER makecache -q"
        PKG_INSTALL="$PKG_MANAGER install -y -q"
        ;;
    alpine)
        PKG_MANAGER="apk"
        PKG_UPDATE="apk update"
        PKG_INSTALL="apk add --quiet"
        ;;
    *)
        log_warn "Unsupported OS: $OS_NAME. Attempting installation anyway..."
        PKG_MANAGER="apt"
        PKG_UPDATE="apt update -qq"
        PKG_INSTALL="apt install -y -qq"
        ;;
esac

log_success "OS: $OS_NAME $OS_VERSION"

# Architecture
ARCH=$(uname -m)
log_success "Architecture: $ARCH"

# RAM Check
if [ -f /proc/meminfo ]; then
    TOTAL_RAM=$(grep MemTotal /proc/meminfo | awk '{print int($2/1024)}')
    log_success "RAM: ${TOTAL_RAM} MB"

    if [ "$TOTAL_RAM" -lt 256 ]; then
        log_warn "Low RAM detected. Minimum 256MB recommended."
    fi
fi

# Disk Check
DISK_FREE=$(df -m / | awk 'NR==2{print $4}')
log_success "Free Disk: ${DISK_FREE} MB"

if [ "$DISK_FREE" -lt 200 ]; then
    log_error "Insufficient disk space. At least 200MB required."
    exit 1
fi

echo ""

# ==================== Install Dependencies ====================
echo -e "${BOLD}${BLUE}[2/6] Installing Dependencies${NC}"
echo ""

# Update package manager
log_info "Updating package lists..."
$PKG_UPDATE > /dev/null 2>&1 || true

# Install required packages
log_info "Installing required packages..."
case $PKG_MANAGER in
    apt)
        $PKG_INSTALL curl wget git openssl ca-certificates gnupg lsb-release > /dev/null 2>&1
        ;;
    yum|dnf)
        $PKG_INSTALL curl wget git openssl ca-certificates > /dev/null 2>&1
        ;;
    apk)
        $PKG_INSTALL curl wget git openssl ca-certificates nodejs npm > /dev/null 2>&1
        ;;
esac
log_success "Required packages installed"

# Node.js Installation
log_info "Checking Node.js..."

install_nodejs() {
    case $PKG_MANAGER in
        apt)
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
            apt install -y nodejs > /dev/null 2>&1
            ;;
        yum|dnf)
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
            $PKG_INSTALL nodejs > /dev/null 2>&1
            ;;
        apk)
            # Already installed above
            ;;
    esac
}

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        log_success "Node.js $(node -v) already installed"
    else
        log_info "Upgrading Node.js..."
        install_nodejs
        log_success "Node.js upgraded to $(node -v)"
    fi
else
    log_info "Installing Node.js..."
    install_nodejs
    log_success "Node.js $(node -v) installed"
fi

echo ""

# ==================== Configuration ====================
echo -e "${BOLD}${BLUE}[3/6] Configuration${NC}"
echo ""

# Auto-detect IP
log_info "Detecting public IP address..."
AUTO_IP=$(curl -s --connect-timeout 5 ifconfig.me 2>/dev/null || \
          curl -s --connect-timeout 5 icanhazip.com 2>/dev/null || \
          curl -s --connect-timeout 5 ipinfo.io/ip 2>/dev/null || \
          echo "")

if [ -n "$AUTO_IP" ]; then
    log_success "Detected IP: $AUTO_IP"
else
    log_warn "Could not auto-detect IP"
fi

echo ""
echo -e "${CYAN}─────────────────────────────────────────────────────────────${NC}"
echo -e "${BOLD}                    Server Configuration${NC}"
echo -e "${CYAN}─────────────────────────────────────────────────────────────${NC}"
echo ""

# Server IP
if [ -n "$AUTO_IP" ]; then
    printf "Server IP [$AUTO_IP]: "
    read SERVER_IP
    SERVER_IP=${SERVER_IP:-$AUTO_IP}
else
    printf "Server IP: "
    read SERVER_IP
fi

# Validate IP
if [[ ! $SERVER_IP =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    log_error "Invalid IP address"
    exit 1
fi

# Domain
echo ""
echo -e "${YELLOW}Domain format: tunnel.yourdomain.com${NC}"
echo -e "${YELLOW}Tunnels will be: *.tunnel.yourdomain.com${NC}"
echo ""
printf "Domain: "
read DOMAIN

if [ -z "$DOMAIN" ]; then
    log_error "Domain cannot be empty"
    exit 1
fi

# Ports (with defaults)
echo ""
printf "HTTP Port [80]: "
read HTTP_PORT
HTTP_PORT=${HTTP_PORT:-80}

printf "WebSocket Port [8081]: "
read WS_PORT
WS_PORT=${WS_PORT:-8081}

printf "API Port [8082]: "
read API_PORT
API_PORT=${API_PORT:-8082}

# Generate Token
AUTH_TOKEN=$(openssl rand -hex 32)

echo ""
echo -e "${CYAN}─────────────────────────────────────────────────────────────${NC}"
echo -e "${BOLD}                    Installation Summary${NC}"
echo -e "${CYAN}─────────────────────────────────────────────────────────────${NC}"
echo ""
echo -e "  Server IP:      ${GREEN}$SERVER_IP${NC}"
echo -e "  Domain:         ${GREEN}*.$DOMAIN${NC}"
echo -e "  HTTP Port:      ${GREEN}$HTTP_PORT${NC}"
echo -e "  WebSocket Port: ${GREEN}$WS_PORT${NC}"
echo -e "  API Port:       ${GREEN}$API_PORT${NC}"
echo -e "  Install Dir:    ${GREEN}$INSTALL_DIR${NC}"
echo ""
printf "Continue with installation? [Y/n]: "
read CONFIRM
CONFIRM=${CONFIRM:-Y}

if [[ "$CONFIRM" =~ ^[Nn]$ ]]; then
    log_warn "Installation cancelled"
    exit 0
fi

echo ""

# ==================== Download & Install ====================
echo -e "${BOLD}${BLUE}[4/6] Installing PiTunnel Server${NC}"
echo ""

# Create directories
log_info "Creating directories..."
mkdir -p $INSTALL_DIR/server/pages
mkdir -p $CONFIG_DIR
mkdir -p $LOG_DIR
log_success "Directories created"

# Download files from GitHub
log_info "Downloading PiTunnel Server..."

# Download main files
curl -fsSL "$RAW_URL/index.js" -o "$INSTALL_DIR/server/index.js" 2>/dev/null || {
    log_error "Failed to download index.js"
    exit 1
}

curl -fsSL "$RAW_URL/package.json" -o "$INSTALL_DIR/server/package.json" 2>/dev/null || {
    log_error "Failed to download package.json"
    exit 1
}

# Download page templates (optional)
curl -fsSL "$RAW_URL/pages/tunnel-inactive.html" -o "$INSTALL_DIR/server/pages/tunnel-inactive.html" 2>/dev/null || true
curl -fsSL "$RAW_URL/pages/tunnel-error.html" -o "$INSTALL_DIR/server/pages/tunnel-error.html" 2>/dev/null || true

log_success "PiTunnel Server downloaded"

# Create config file
log_info "Creating configuration..."
cat > "$CONFIG_DIR/config.json" << EOF
{
    "serverIP": "$SERVER_IP",
    "domain": "$DOMAIN",
    "httpPort": $HTTP_PORT,
    "wsPort": $WS_PORT,
    "apiPort": $API_PORT,
    "authToken": "$AUTH_TOKEN",
    "logLevel": "info"
}
EOF

# Symlink config
ln -sf "$CONFIG_DIR/config.json" "$INSTALL_DIR/server/config.json"
log_success "Configuration created"

# Install npm dependencies
log_info "Installing dependencies..."
cd "$INSTALL_DIR/server"
npm install --silent --no-progress > /dev/null 2>&1
log_success "Dependencies installed"

echo ""

# ==================== Systemd Service ====================
echo -e "${BOLD}${BLUE}[5/6] Setting Up System Service${NC}"
echo ""

log_info "Creating systemd service..."

cat > /etc/systemd/system/pitunnel.service << EOF
[Unit]
Description=PiTunnel Server
Documentation=$REPO_URL
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/server
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

# Logging
StandardOutput=append:$LOG_DIR/server.log
StandardError=append:$LOG_DIR/error.log

# Limits
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
systemctl daemon-reload
systemctl enable pitunnel > /dev/null 2>&1
systemctl stop pitunnel > /dev/null 2>&1 || true
systemctl start pitunnel

log_success "Systemd service created and started"

echo ""

# ==================== Firewall ====================
echo -e "${BOLD}${BLUE}[6/6] Configuring Firewall${NC}"
echo ""

if command -v ufw &> /dev/null; then
    log_info "Configuring UFW firewall..."
    ufw allow 22/tcp > /dev/null 2>&1        # SSH
    ufw allow $HTTP_PORT/tcp > /dev/null 2>&1
    ufw allow $WS_PORT/tcp > /dev/null 2>&1
    ufw allow $API_PORT/tcp > /dev/null 2>&1
    ufw allow 3000:9999/tcp > /dev/null 2>&1  # Dynamic ports
    ufw --force enable > /dev/null 2>&1 || true
    log_success "UFW firewall configured"
elif command -v firewall-cmd &> /dev/null; then
    log_info "Configuring firewalld..."
    firewall-cmd --permanent --add-port=22/tcp > /dev/null 2>&1
    firewall-cmd --permanent --add-port=$HTTP_PORT/tcp > /dev/null 2>&1
    firewall-cmd --permanent --add-port=$WS_PORT/tcp > /dev/null 2>&1
    firewall-cmd --permanent --add-port=$API_PORT/tcp > /dev/null 2>&1
    firewall-cmd --permanent --add-port=3000-9999/tcp > /dev/null 2>&1
    firewall-cmd --reload > /dev/null 2>&1
    log_success "Firewalld configured"
else
    log_warn "No firewall detected. Please configure manually."
fi

echo ""

# ==================== Verify Installation ====================
sleep 2
SERVICE_STATUS=$(systemctl is-active pitunnel 2>/dev/null || echo "inactive")

# ==================== Success ====================
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}           ✅ PiTunnel Server Installed Successfully!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""

if [ "$SERVICE_STATUS" = "active" ]; then
    echo -e "  Service Status: ${GREEN}● Running${NC}"
else
    echo -e "  Service Status: ${RED}● Not Running${NC}"
    echo -e "  Check logs: ${CYAN}journalctl -u pitunnel -f${NC}"
fi

echo ""
echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
echo -e "${RED}${BOLD}               🔑 SAVE YOUR AUTH TOKEN!${NC}"
echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${YELLOW}$AUTH_TOKEN${NC}"
echo ""
echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}${BOLD}                    DNS Configuration${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Add these DNS records to your domain:"
echo ""
echo -e "  ${BOLD}Type    Name    Content${NC}"
echo -e "  ─────────────────────────────────────"
echo -e "  A       @       $SERVER_IP"
echo -e "  A       *       $SERVER_IP"
echo ""

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}${BOLD}                    Client Setup${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Install client:${NC}"
echo -e "  ${GREEN}npm install -g ptclient${NC}"
echo ""
echo -e "  ${BOLD}Login to server:${NC}"
echo -e "  ${GREEN}ptclient login${NC}"
echo -e "  Server: ${CYAN}$SERVER_IP${NC}"
echo -e "  Token:  ${CYAN}$AUTH_TOKEN${NC}"
echo ""
echo -e "  ${BOLD}Start a tunnel:${NC}"
echo -e "  ${GREEN}ptclient start${NC}"
echo ""

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}${BOLD}                   Useful Commands${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  View logs:        ${GREEN}journalctl -u pitunnel -f${NC}"
echo -e "  Service status:   ${GREEN}systemctl status pitunnel${NC}"
echo -e "  Restart server:   ${GREEN}systemctl restart pitunnel${NC}"
echo -e "  View config:      ${GREEN}cat $CONFIG_DIR/config.json${NC}"
echo -e "  View token:       ${GREEN}cat $CONFIG_DIR/config.json | grep authToken${NC}"
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${MAGENTA}GitHub: $REPO_URL${NC}"
echo ""
