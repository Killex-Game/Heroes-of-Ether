set -euo pipefail
# Usage: bash install-maintenance-nginx.sh [release-or-staging-root]
source_root=${1:-/opt/sferorumia/current}
install -d -m 755 /var/www/sferorumia-maintenance
install -m 644 "$source_root/public/maintenance.html" /var/www/sferorumia-maintenance/maintenance.html
install -m 644 "$source_root/public/styles/components/maintenance.css" /var/www/sferorumia-maintenance/maintenance.css
install -m 644 "$source_root/public/ui/layout/maintenance.js" /var/www/sferorumia-maintenance/maintenance.js
install -m 644 "$source_root/deployment/maintenance/nginx.conf" /etc/nginx/snippets/sferorumia-maintenance.conf
backup=$(mktemp /etc/nginx/sites-available/sferorumia.before-maintenance.XXXXXX)
cp -p /etc/nginx/sites-available/sferorumia "$backup"
python3 - <<'PY'
import pathlib
p=pathlib.Path('/etc/nginx/sites-available/sferorumia');s=p.read_text()
assert 'server_name 85-198-66-55.sslip.io;' in s
marker='  location / {\n    proxy_pass http://127.0.0.1:3000;'
if 'include /etc/nginx/snippets/sferorumia-maintenance.conf;' not in s:
 assert s.count(marker)==1
 s=s.replace(marker, '  include /etc/nginx/snippets/sferorumia-maintenance.conf;\n'+marker+'\n    proxy_intercept_errors on;\n    error_page 502 504 =503 /maintenance.html;')
 p.write_text(s)
PY
if nginx -t; then systemctl reload nginx; else cp -p "$backup" /etc/nginx/sites-available/sferorumia;exit 1;fi
printf 'Maintenance fallback configured; backup: %s\n' "$backup"
