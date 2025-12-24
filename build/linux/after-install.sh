#!/bin/bash

# Create symlink or update-alternatives
if type update-alternatives 2>/dev/null >&1; then
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Set SUID bit on chrome-sandbox for Ubuntu 24.04+ compatibility
# See: https://github.com/WaveSpeedAI/wavespeed-desktop/issues/13
chrome_sandbox_path='/opt/${sanitizedProductName}/chrome-sandbox'
if [ -f "$chrome_sandbox_path" ]; then
    chown root:root "$chrome_sandbox_path" || true
    chmod 4755 "$chrome_sandbox_path" || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
