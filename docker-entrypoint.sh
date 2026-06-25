#!/bin/sh
# Substitute GRAMPS_API_URL into the nginx proxy config (leave nginx's own $vars alone)
envsubst '${GRAMPS_API_URL}' \
  < /etc/nginx/conf.d/default.conf.template \
  > /etc/nginx/conf.d/default.conf

# Regenerate runtime config.js from env vars so the SPA gets credentials at
# container start (not baked in at build time). The SPA talks to same-origin
# /api; nginx proxies that to GRAMPS_API_URL.
cat > /usr/share/nginx/html/config.js <<EOF
window.__VIEWER_CONFIG__ = {
  GRAMPS_API_URL: "/api",
  GRAMPS_VIEWER_USER: "${GRAMPS_VIEWER_USER}",
  GRAMPS_VIEWER_PASS: "${GRAMPS_VIEWER_PASS}",
  TITLE: "${VIEWER_TITLE:-Family Tree}"
};
EOF

exec nginx -g 'daemon off;'
