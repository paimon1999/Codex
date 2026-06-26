#!/usr/bin/env bash
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
BINARY_NAME="ucodex"
INSTALL_DIR="$HOME/.codex-session-delete/bin"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_BIN="$PROJECT_ROOT/target/release/$BINARY_NAME"

# ── Colors ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✘${NC} $*"; exit 1; }

# ── Preflight ─────────────────────────────────────────────────────────────
command -v cargo >/dev/null || fail "cargo not found"

cd "$PROJECT_ROOT"

# ── Build Manager Frontend ────────────────────────────────────────────────
MANAGER_DIR="$PROJECT_ROOT/apps/ucodex-manager"
if [[ -f "$MANAGER_DIR/package.json" ]]; then
    info "Building Manager frontend (vite build)..."
    npm --prefix "$MANAGER_DIR" run vite:build 2>&1
    ok "Manager frontend built → $MANAGER_DIR/dist/"
fi

# ── Build ─────────────────────────────────────────────────────────────────
info "Building release (ucodex-launcher)..."
cargo build --release -p ucodex-launcher 2>&1
ok "Build complete: $RELEASE_BIN"

# ── Strip (macOS) ─────────────────────────────────────────────────────────
if [[ "$(uname)" == "Darwin" ]]; then
    info "Stripping debug symbols (macOS)..."
    strip "$RELEASE_BIN"
    ok "Stripped"

    info "Re-signing with ad-hoc signature..."
    codesign --sign - "$RELEASE_BIN"
    ok "Signed"
fi

# ── Install ───────────────────────────────────────────────────────────────
info "Installing to $INSTALL_DIR/"
mkdir -p "$INSTALL_DIR"
cp "$RELEASE_BIN" "$INSTALL_DIR/$BINARY_NAME"
chmod +x "$INSTALL_DIR/$BINARY_NAME"
ok "Installed: $INSTALL_DIR/$BINARY_NAME"

# ── Verify ────────────────────────────────────────────────────────────────
info "Verifying..."
if "$INSTALL_DIR/$BINARY_NAME" --version >/dev/null 2>&1; then
    VERSION=$("$INSTALL_DIR/$BINARY_NAME" --version 2>&1 | head -1)
    ok "Version: $VERSION"
else
    warn "Binary installed but --version check failed (may need Codex app present)"
fi

echo ""
ok "Done! Run with: $INSTALL_DIR/$BINARY_NAME"
