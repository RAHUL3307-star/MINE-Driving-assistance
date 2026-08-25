import re
import json

with open('bundle.js', 'r', encoding='utf-8', errors='ignore') as f:
    code = f.read()

print(f"Bundle Length: {len(code)}")

# Look for React component definitions, Lucide icons, routes, text
# Let's search for key domain words: Mine, Vehicle, Safety, Shield, ESP32, Dashboard, etc.
matches = re.findall(r'[\'"`]([^\'"`\n\r]{5,100})[\'"`]', code)
interesting = [m for m in set(matches) if any(k in m.lower() for k in ['mine', 'safety', 'shield', 'visibility', 'obstacle', 'risk', 'speed', 'vehicle', 'alert', 'demo', 'driver', 'collision', 'emergency', 'sensor', 'esp32', 'telemetry', 'analytics', 'history'])]

print(f"Found {len(interesting)} domain strings.")
with open('extracted_strings.txt', 'w', encoding='utf-8') as out:
    for s in sorted(interesting):
        out.write(s + '\n')

print("Top 50 domain strings written to extracted_strings.txt")
