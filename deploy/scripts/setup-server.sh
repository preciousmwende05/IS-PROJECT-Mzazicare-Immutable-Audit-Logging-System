#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 22.04/24.04 server for MzaziCare.
#
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/scripts/setup-server.sh -o setup.sh
#   sudo bash setup.sh https://github.com/<you>/<repo>.git
#
# Installs Docker, a firewall (only SSH, HTTP, HTTPS open), 2 GB of swap,
# automatic security updates, Python for the ML alerts, and clones the repo
# into /opt/mzazicare. Safe to run twice.
set -euo pipefail

REPO_URL="${1:?Usage: sudo bash setup-server.sh <git-repo-url>}"
APP_DIR=/opt/mzazicare
APP_USER="${SUDO_USER:-$(whoami)}"

echo "==> System updates"
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw unattended-upgrades python3 python3-venv python3-pip
dpkg-reconfigure -f noninteractive unattended-upgrades
timedatectl set-timezone Africa/Nairobi

echo "==> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$APP_USER"
systemctl enable --now docker

echo "==> Firewall: SSH, HTTP, HTTPS only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> 2 GB swap (keeps a 2 GB server from running out of memory during builds)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

echo "==> Code in $APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> Python environment for the ML alerts"
sudo -u "$APP_USER" python3 -m venv "$APP_DIR/ml/.venv"
sudo -u "$APP_USER" "$APP_DIR/ml/.venv/bin/pip" install -q -r "$APP_DIR/ml/audit-anomaly/requirements.txt"

cat <<EOF

Done. Next (as $APP_USER, after logging out and back in so Docker works without sudo):
  cd $APP_DIR/deploy
  cp .env.example .env && nano .env
  bash scripts/deploy.sh
EOF
