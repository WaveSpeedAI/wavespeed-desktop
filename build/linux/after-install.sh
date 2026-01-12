#!/bin/bash

# Create wrapper script with --no-sandbox for Ubuntu 24.04+ compatibility
# The Electron sandbox requires either SUID chrome-sandbox or --no-sandbox flag
cat > '/usr/bin/${executable}' << 'EOF'
#!/bin/bash
exec '/opt/${sanitizedProductName}/${executable}' --no-sandbox "$@"
EOF
chmod +x '/usr/bin/${executable}'

# Fix desktop file to use wrapper script (electron-builder adds invalid lowercase exec=)
DESKTOP_FILE='/usr/share/applications/${executable}.desktop'
if [ -f "$DESKTOP_FILE" ]; then
    # Replace Exec= line to use wrapper script
    sed -i 's|^Exec=.*|Exec=/usr/bin/${executable} %U|' "$DESKTOP_FILE"
    # Remove invalid lowercase exec= line if present
    sed -i '/^exec=/d' "$DESKTOP_FILE"
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install icon in multiple sizes (electron-builder only installs 1024x1024)
ICON_SOURCE='/usr/share/icons/hicolor/1024x1024/apps/${executable}.png'
if [ -f "$ICON_SOURCE" ]; then
    for SIZE in 512x512 256x256 128x128 64x64 48x48; do
        mkdir -p "/usr/share/icons/hicolor/$SIZE/apps"
        cp "$ICON_SOURCE" "/usr/share/icons/hicolor/$SIZE/apps/${executable}.png"
    done
fi

# Update icon cache
if hash gtk-update-icon-cache 2>/dev/null; then
    gtk-update-icon-cache /usr/share/icons/hicolor -f || true
fi
