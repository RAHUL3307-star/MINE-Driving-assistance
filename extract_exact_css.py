import re

with open('bundle.js', 'r', encoding='utf-8', errors='ignore') as f:
    code = f.read()

# Webpack injects styles using css-loader. Let's find all CSS strings in bundle.js
# In webpack, css modules contain strings with CSS rules
# Let's extract all string literals that contain CSS syntax
css_chunks = []
# Find strings that have css patterns like: .app-shell, .sidebar, .brand, .risk-panel, etc.
matches = re.findall(r'\"([^\"]*?\.(?:app-shell|sidebar|brand-mark|fleet-chip|risk-status-panel|telemetry-card|live-dot|emergency-banner|login-hero)[^\"]*?)\"', code)

print(f"Found {len(matches)} main CSS chunks.")
full_css = ""
for m in matches:
    # unescape string
    try:
        clean = m.encode('utf-8').decode('unicode-escape')
        full_css += clean + "\n\n"
    except:
        full_css += m + "\n\n"

with open('oreguard_styles.css', 'w', encoding='utf-8') as out:
    out.write(full_css)

print(f"Wrote {len(full_css)} bytes of CSS to oreguard_styles.css")
