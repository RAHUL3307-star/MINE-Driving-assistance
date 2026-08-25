import re

with open('bundle.js', 'r', encoding='utf-8', errors='ignore') as f:
    code = f.read()

# Let's search for React components in bundle.js
# React component files in webpack usually have comments like //! ./src/components/... or webpack module definitions
modules = re.findall(r'(\/\*! \.\/src\/[^*]+\*\/[\s\S]*?(?=\/\*! \.\/src\/|$))', code)
print(f"Found {len(modules)} src modules in bundle.")

with open('extracted_components.txt', 'w', encoding='utf-8') as out:
    for m in modules:
        out.write("="*60 + "\n")
        out.write(m[:5000] + "\n\n")

# If webpack doesn't have standard comment markers, let's search for functions returning JSX / html tags
if len(modules) == 0:
    # search for specific keywords in context
    pos = 0
    with open('extracted_components.txt', 'w', encoding='utf-8') as out:
        for kw in ['ENTER SAFETY CONSOLE', 'VEHICLE MV-07', 'MINE VEHICLE / SAFETY LAYER', 'CURRENT RISK LEVEL', 'RESET EMERGENCY STOP', 'Risk engine thresholds']:
            idx = code.find(kw)
            if idx != -1:
                start = max(0, idx - 1000)
                end = min(len(code), idx + 2500)
                out.write(f"=== SNIPPET FOR: {kw} ===\n")
                out.write(code[start:end] + "\n\n")

print("Finished extraction to extracted_components.txt")
