#!/bin/bash

# PiTunnel Server - One-Line Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Pi-Tunnel/Server/refs/heads/main/setup.sh -o /tmp/setup.sh && sudo bash /tmp/setup.sh

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
WHITE='\033[1;37m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Installation directory
INSTALL_DIR="/opt/pitunnel"
CONFIG_DIR="/etc/pitunnel"
LOG_DIR="/var/log/pitunnel"

# ==================== Animation Functions ====================

# Spinner animation
spinner() {
    local pid=$1
    local msg=$2
    local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local i=0

    tput civis  # Hide cursor
    while kill -0 $pid 2>/dev/null; do
        local char="${spinstr:$i:1}"
        printf "\r  ${CYAN}${char}${NC} ${msg}"
        i=$(( (i + 1) % ${#spinstr} ))
        sleep 0.1
    done
    tput cnorm  # Show cursor
    printf "\r"
}

# Progress bar
progress_bar() {
    local current=$1
    local total=$2
    local width=40
    local percentage=$((current * 100 / total))
    local filled=$((current * width / total))
    local empty=$((width - filled))

    printf "\r  ["
    printf "${GREEN}"
    for ((i=0; i<filled; i++)); do printf "█"; done
    printf "${DIM}"
    for ((i=0; i<empty; i++)); do printf "░"; done
    printf "${NC}] ${percentage}%%"
}

# Typing effect
type_text() {
    local text="$1"
    local delay=${2:-0.03}
    for ((i=0; i<${#text}; i++)); do
        printf "%s" "${text:$i:1}"
        sleep $delay
    done
    echo ""
}

# Success animation
show_success() {
    local msg=$1
    printf "\r  ${GREEN}✓${NC} ${msg}                    \n"
}

# Error animation
show_error() {
    local msg=$1
    printf "\r  ${RED}✗${NC} ${msg}                    \n"
}

# Info with animation
show_info() {
    local msg=$1
    printf "  ${BLUE}→${NC} ${msg}\n"
}

# Warning
show_warn() {
    local msg=$1
    printf "  ${YELLOW}!${NC} ${msg}\n"
}

# Step header with animation
show_step() {
    local step=$1
    local total=$2
    local title=$3

    echo ""
    echo -e "${BOLD}${CYAN}[$step/$total]${NC} ${BOLD}${title}${NC}"
    echo -e "${DIM}────────────────────────────────────────────${NC}"
}

# Animated banner
show_banner() {
    clear
    echo ""

    # Animated logo reveal
    local logo=(
        "    ____  _ ______                       __"
        "   / __ \\(_)_  __/_  ______  ____  ___  / /"
        "  / /_/ / / / / / / / / __ \\/ __ \\/ _ \\/ /"
        " / ____/ / / / / /_/ / / / / / / /  __/ /"
        "/_/   /_/ /_/  \\__,_/_/ /_/_/ /_/\\___/_/"
    )

    echo -e "${CYAN}"
    for line in "${logo[@]}"; do
        echo "$line"
        sleep 0.05
    done
    echo -e "${NC}"

    sleep 0.2

    # Animated border
    local border="═══════════════════════════════════════════════════════════"
    echo -ne "${BOLD}${CYAN}"
    for ((i=0; i<${#border}; i++)); do
        echo -n "${border:$i:1}"
        sleep 0.005
    done
    echo -e "${NC}"

    echo -e "${BOLD}${WHITE}          PiTunnel Server - One-Line Installer v${VERSION}${NC}"

    echo -ne "${BOLD}${CYAN}"
    for ((i=0; i<${#border}; i++)); do
        echo -n "${border:$i:1}"
        sleep 0.005
    done
    echo -e "${NC}"
    echo ""
}

# Countdown animation
countdown() {
    local seconds=$1
    local msg=$2
    for ((i=seconds; i>0; i--)); do
        printf "\r  ${YELLOW}${msg} ${i}...${NC}  "
        sleep 1
    done
    printf "\r                                        \r"
}

# Loading dots animation
loading_dots() {
    local pid=$1
    local msg=$2
    local dots=""

    while kill -0 $pid 2>/dev/null; do
        dots="${dots}."
        if [ ${#dots} -gt 3 ]; then
            dots=""
        fi
        printf "\r  ${BLUE}→${NC} ${msg}%-4s" "$dots"
        sleep 0.3
    done
    printf "\r"
}

# Run command with spinner
run_with_spinner() {
    local msg=$1
    shift
    local cmd="$@"

    eval "$cmd" > /dev/null 2>&1 &
    local pid=$!
    spinner $pid "$msg"
    wait $pid
    local status=$?

    if [ $status -eq 0 ]; then
        show_success "$msg"
    else
        show_error "$msg"
        return $status
    fi
}

# Run command with progress simulation
run_with_progress() {
    local msg=$1
    local duration=$2
    shift 2
    local cmd="$@"

    eval "$cmd" > /dev/null 2>&1 &
    local pid=$!

    local elapsed=0
    local step=$((duration / 20))
    [ $step -eq 0 ] && step=1

    while kill -0 $pid 2>/dev/null; do
        if [ $elapsed -lt 95 ]; then
            elapsed=$((elapsed + 5))
        fi
        progress_bar $elapsed 100
        printf " ${msg}"
        sleep 0.$step
    done

    wait $pid
    local status=$?

    progress_bar 100 100
    printf " ${msg}"
    echo ""

    return $status
}

# ==================== Root Check ====================
if [ "$EUID" -ne 0 ]; then
    echo ""
    show_error "This script must be run as root"
    echo ""
    echo -e "  Run with: ${CYAN}curl -fsSL $RAW_URL/setup.sh -o /tmp/setup.sh && sudo bash /tmp/setup.sh${NC}"
    echo ""
    exit 1
fi

# ==================== Show Banner ====================
show_banner

sleep 0.5

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
show_step 1 6 "Checking System Requirements"

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
        show_warn "Unsupported OS: $OS_NAME. Attempting installation anyway..."
        PKG_MANAGER="apt"
        PKG_UPDATE="apt update -qq"
        PKG_INSTALL="apt install -y -qq"
        ;;
esac

sleep 0.2
show_success "OS: $OS_NAME $OS_VERSION"

# Architecture
ARCH=$(uname -m)
sleep 0.2
show_success "Architecture: $ARCH"

# RAM Check
if [ -f /proc/meminfo ]; then
    TOTAL_RAM=$(grep MemTotal /proc/meminfo | awk '{print int($2/1024)}')
    sleep 0.2
    show_success "RAM: ${TOTAL_RAM} MB"

    if [ "$TOTAL_RAM" -lt 256 ]; then
        show_warn "Low RAM detected. Minimum 256MB recommended."
    fi
fi

# Disk Check
DISK_FREE=$(df -m / | awk 'NR==2{print $4}')
sleep 0.2
show_success "Free Disk: ${DISK_FREE} MB"

if [ "$DISK_FREE" -lt 200 ]; then
    show_error "Insufficient disk space. At least 200MB required."
    exit 1
fi

sleep 0.3

# ==================== Install Dependencies ====================
show_step 2 6 "Installing Dependencies"

# Update package manager
run_with_spinner "Updating package lists" "$PKG_UPDATE" || true

# Install required packages
case $PKG_MANAGER in
    apt)
        run_with_spinner "Installing required packages" "$PKG_INSTALL curl wget git openssl ca-certificates gnupg lsb-release"
        ;;
    yum|dnf)
        run_with_spinner "Installing required packages" "$PKG_INSTALL curl wget git openssl ca-certificates"
        ;;
    apk)
        run_with_spinner "Installing required packages" "$PKG_INSTALL curl wget git openssl ca-certificates nodejs npm"
        ;;
esac

# Node.js Installation
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
        show_success "Node.js $(node -v) already installed"
    else
        run_with_spinner "Upgrading Node.js" install_nodejs
        show_success "Node.js upgraded to $(node -v)"
    fi
else
    run_with_spinner "Installing Node.js 20.x" install_nodejs
    show_success "Node.js $(node -v) installed"
fi

sleep 0.3

# ==================== Configuration ====================
show_step 3 6 "Configuration"

# Auto-detect IP
echo -ne "  ${BLUE}→${NC} Detecting public IP address"
AUTO_IP=""
for i in 1 2 3; do
    echo -n "."
    sleep 0.3
done

AUTO_IP=$(curl -s --connect-timeout 5 ifconfig.me 2>/dev/null || \
          curl -s --connect-timeout 5 icanhazip.com 2>/dev/null || \
          curl -s --connect-timeout 5 ipinfo.io/ip 2>/dev/null || \
          echo "")

if [ -n "$AUTO_IP" ]; then
    echo ""
    show_success "Detected IP: $AUTO_IP"
else
    echo ""
    show_warn "Could not auto-detect IP"
fi

echo ""
echo -e "  ${CYAN}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "  ${CYAN}│${NC}            ${BOLD}Server Configuration${NC}                        ${CYAN}│${NC}"
echo -e "  ${CYAN}└─────────────────────────────────────────────────────────┘${NC}"
echo ""

# Server IP
if [ -n "$AUTO_IP" ]; then
    printf "  ${WHITE}Server IP${NC} ${DIM}[$AUTO_IP]${NC}: "
    read SERVER_IP
    SERVER_IP=${SERVER_IP:-$AUTO_IP}
else
    printf "  ${WHITE}Server IP${NC}: "
    read SERVER_IP
fi

# Validate IP
if [[ ! $SERVER_IP =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    show_error "Invalid IP address"
    exit 1
fi

# Domain
echo ""
echo -e "  ${DIM}Format: tunnel.yourdomain.com${NC}"
echo -e "  ${DIM}Tunnels will be accessible at: *.tunnel.yourdomain.com${NC}"
echo ""
printf "  ${WHITE}Domain${NC}: "
read DOMAIN

if [ -z "$DOMAIN" ]; then
    show_error "Domain cannot be empty"
    exit 1
fi

# Ports (with defaults)
echo ""
printf "  ${WHITE}HTTP Port${NC} ${DIM}[80]${NC}: "
read HTTP_PORT
HTTP_PORT=${HTTP_PORT:-80}

printf "  ${WHITE}WebSocket Port${NC} ${DIM}[8081]${NC}: "
read WS_PORT
WS_PORT=${WS_PORT:-8081}

printf "  ${WHITE}API Port${NC} ${DIM}[8082]${NC}: "
read API_PORT
API_PORT=${API_PORT:-8082}

# Generate Token
AUTH_TOKEN=$(openssl rand -hex 32)

echo ""
echo -e "  ${CYAN}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "  ${CYAN}│${NC}            ${BOLD}Installation Summary${NC}                        ${CYAN}│${NC}"
echo -e "  ${CYAN}└─────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "  ${DIM}Server IP:${NC}      ${GREEN}$SERVER_IP${NC}"
echo -e "  ${DIM}Domain:${NC}         ${GREEN}*.$DOMAIN${NC}"
echo -e "  ${DIM}HTTP Port:${NC}      ${GREEN}$HTTP_PORT${NC}"
echo -e "  ${DIM}WebSocket Port:${NC} ${GREEN}$WS_PORT${NC}"
echo -e "  ${DIM}API Port:${NC}       ${GREEN}$API_PORT${NC}"
echo -e "  ${DIM}Install Dir:${NC}    ${GREEN}$INSTALL_DIR${NC}"
echo ""
printf "  ${WHITE}Continue with installation?${NC} ${DIM}[Y/n]${NC}: "
read CONFIRM
CONFIRM=${CONFIRM:-Y}

if [[ "$CONFIRM" =~ ^[Nn]$ ]]; then
    show_warn "Installation cancelled"
    exit 0
fi

sleep 0.3

# ==================== Download & Install ====================
show_step 4 6 "Installing PiTunnel Server"

# Create directories
run_with_spinner "Creating directories" "mkdir -p $INSTALL_DIR/server/pages $CONFIG_DIR $LOG_DIR"

# Download files from GitHub
echo -ne "  ${BLUE}→${NC} Downloading PiTunnel Server"

# Animated download
(
    curl -fsSL "$RAW_URL/index.js" -o "$INSTALL_DIR/server/index.js" 2>/dev/null
    curl -fsSL "$RAW_URL/package.json" -o "$INSTALL_DIR/server/package.json" 2>/dev/null
    curl -fsSL "$RAW_URL/pages/tunnel-inactive.html" -o "$INSTALL_DIR/server/pages/tunnel-inactive.html" 2>/dev/null || true
    curl -fsSL "$RAW_URL/pages/tunnel-error.html" -o "$INSTALL_DIR/server/pages/tunnel-error.html" 2>/dev/null || true
) &
pid=$!

# Download animation
chars="▏▎▍▌▋▊▉█▉▊▋▌▍▎▏"
while kill -0 $pid 2>/dev/null; do
    for ((i=0; i<${#chars}; i++)); do
        printf "\r  ${CYAN}${chars:$i:1}${NC} Downloading PiTunnel Server"
        sleep 0.05
        if ! kill -0 $pid 2>/dev/null; then
            break
        fi
    done
done
wait $pid

if [ -f "$INSTALL_DIR/server/index.js" ]; then
    show_success "PiTunnel Server downloaded"
else
    show_error "Failed to download PiTunnel Server"
    exit 1
fi

# Create config file
run_with_spinner "Creating configuration" "cat > '$CONFIG_DIR/config.json' << EOF
{
    \"serverIP\": \"$SERVER_IP\",
    \"domain\": \"$DOMAIN\",
    \"httpPort\": $HTTP_PORT,
    \"wsPort\": $WS_PORT,
    \"apiPort\": $API_PORT,
    \"authToken\": \"$AUTH_TOKEN\",
    \"logLevel\": \"info\"
}
EOF
ln -sf '$CONFIG_DIR/config.json' '$INSTALL_DIR/server/config.json'"

# Install npm dependencies
echo -ne "  ${BLUE}→${NC} Installing dependencies"

(cd "$INSTALL_DIR/server" && npm install --silent --no-progress > /dev/null 2>&1) &
pid=$!

# Progress animation for npm install
progress=0
while kill -0 $pid 2>/dev/null; do
    if [ $progress -lt 95 ]; then
        progress=$((progress + 2))
    fi
    progress_bar $progress 100
    printf " Installing dependencies"
    sleep 0.2
done

wait $pid
progress_bar 100 100
printf " Installing dependencies"
echo ""
show_success "Dependencies installed"

sleep 0.3

# ==================== Systemd Service ====================
show_step 5 6 "Setting Up System Service"

run_with_spinner "Creating systemd service" "cat > /etc/systemd/system/pitunnel.service << EOF
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
EOF"

# Enable and start service with animation
run_with_spinner "Enabling service" "systemctl daemon-reload && systemctl enable pitunnel"
run_with_spinner "Starting PiTunnel Server" "systemctl stop pitunnel 2>/dev/null || true; systemctl start pitunnel"

# Create ptserver CLI wrapper
run_with_spinner "Creating ptserver CLI" "echo '#!/bin/bash
cd /opt/pitunnel/server
exec /usr/bin/node index.js \"\$@\"' > /usr/local/bin/ptserver && chmod +x /usr/local/bin/ptserver"

sleep 0.3

# ==================== Firewall ====================
show_step 6 6 "Configuring Firewall"

if command -v ufw &> /dev/null; then
    run_with_spinner "Configuring UFW firewall" "
        ufw allow 22/tcp > /dev/null 2>&1
        ufw allow $HTTP_PORT/tcp > /dev/null 2>&1
        ufw allow $WS_PORT/tcp > /dev/null 2>&1
        ufw allow $API_PORT/tcp > /dev/null 2>&1
        ufw allow 3000:9999/tcp > /dev/null 2>&1
        ufw --force enable > /dev/null 2>&1 || true
    "
elif command -v firewall-cmd &> /dev/null; then
    run_with_spinner "Configuring firewalld" "
        firewall-cmd --permanent --add-port=22/tcp > /dev/null 2>&1
        firewall-cmd --permanent --add-port=$HTTP_PORT/tcp > /dev/null 2>&1
        firewall-cmd --permanent --add-port=$WS_PORT/tcp > /dev/null 2>&1
        firewall-cmd --permanent --add-port=$API_PORT/tcp > /dev/null 2>&1
        firewall-cmd --permanent --add-port=3000-9999/tcp > /dev/null 2>&1
        firewall-cmd --reload > /dev/null 2>&1
    "
else
    show_warn "No firewall detected. Please configure manually."
fi

# ==================== Verify Installation ====================
sleep 2
SERVICE_STATUS=$(systemctl is-active pitunnel 2>/dev/null || echo "inactive")

# ==================== Success Animation ====================
echo ""
echo ""

# Animated success border
success_border() {
    local char="═"
    local width=59
    echo -ne "${GREEN}"
    for ((i=0; i<width; i++)); do
        echo -n "$char"
        sleep 0.01
    done
    echo -e "${NC}"
}

success_border
echo -e "${GREEN}${BOLD}           ✅ PiTunnel Server Installed Successfully!${NC}"
success_border

echo ""

if [ "$SERVICE_STATUS" = "active" ]; then
    echo -e "  Service Status: ${GREEN}● Running${NC}"
else
    echo -e "  Service Status: ${RED}● Not Running${NC}"
    echo -e "  Check logs: ${CYAN}journalctl -u pitunnel -f${NC}"
fi

echo ""

# Token box with animation
echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║${NC}${BOLD}               🔑 SAVE YOUR AUTH TOKEN!${NC}                   ${RED}║${NC}"
echo -e "${RED}╠═══════════════════════════════════════════════════════════╣${NC}"
echo -e "${RED}║${NC}                                                           ${RED}║${NC}"
echo -e "${RED}║${NC}  ${YELLOW}$AUTH_TOKEN${NC}  ${RED}║${NC}"
echo -e "${RED}║${NC}                                                           ${RED}║${NC}"
echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"

echo ""

# DNS Configuration
echo -e "${CYAN}┌───────────────────────────────────────────────────────────┐${NC}"
echo -e "${CYAN}│${NC}${BOLD}                    DNS Configuration${NC}                      ${CYAN}│${NC}"
echo -e "${CYAN}└───────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "  Add these DNS records to your domain:"
echo ""
echo -e "  ${BOLD}Type    Name    Content${NC}"
echo -e "  ${DIM}─────────────────────────────────────${NC}"
echo -e "  A       @       $SERVER_IP"
echo -e "  A       *       $SERVER_IP"
echo ""

# Client Setup
echo -e "${CYAN}┌───────────────────────────────────────────────────────────┐${NC}"
echo -e "${CYAN}│${NC}${BOLD}                    Client Setup${NC}                            ${CYAN}│${NC}"
echo -e "${CYAN}└───────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "  ${BOLD}Install client:${NC}"
echo -e "  ${GREEN}npm install -g ptclient${NC}"
echo ""
echo -e "  ${BOLD}Login to server:${NC}"
echo -e "  ${GREEN}ptclient login${NC}"
echo -e "  ${DIM}Server:${NC} ${CYAN}$SERVER_IP${NC}"
echo -e "  ${DIM}Token:${NC}  ${CYAN}$AUTH_TOKEN${NC}"
echo ""
echo -e "  ${BOLD}Start a tunnel:${NC}"
echo -e "  ${GREEN}ptclient start${NC}"
echo ""

# Useful Commands
echo -e "${CYAN}┌───────────────────────────────────────────────────────────┐${NC}"
echo -e "${CYAN}│${NC}${BOLD}                   Server Commands${NC}                         ${CYAN}│${NC}"
echo -e "${CYAN}└───────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "  ${GREEN}ptserver start${NC}     Start PiTunnel Server"
echo -e "  ${GREEN}ptserver stop${NC}      Stop PiTunnel Server"
echo -e "  ${GREEN}ptserver status${NC}    Show server status"
echo -e "  ${GREEN}ptserver install${NC}   Install as system service"
echo -e "  ${GREEN}ptserver uninstall${NC} Remove system service"
echo ""
echo -e "  ${DIM}View logs:${NC}         ${GREEN}journalctl -u pitunnel -f${NC}"
echo ""

echo -e "  ${MAGENTA}GitHub: $REPO_URL${NC}"
echo ""

# Final animation
echo -ne "  ${GREEN}"
type_text "Installation complete! Happy tunneling! 🚀" 0.02
echo -e "${NC}"
echo ""
