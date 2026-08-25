import re

with open('bundle.js', 'r', encoding='utf-8', errors='ignore') as f:
    code = f.read()

# Let's find the main App function and child components
app_idx = code.find('function App()')
if app_idx == -1:
    app_idx = code.find('const App =')
if app_idx == -1:
    app_idx = code.find('function Dashboard(')

print("App index:", app_idx)

# Search for function declarations in the main src block
funcs = re.findall(r'function\s+([A-Z][A-Za-z0-9_]+)\s*\(([^)]*)\)\s*\{([\s\S]*?)(?=\nfunction\s+[A-Z]|\n\/\* harmony|\Z)', code)
print(f"Found {len(funcs)} React components/functions.")

with open('react_components_clean.txt', 'w', encoding='utf-8') as out:
    for name, args, body in funcs:
        if any(x in body for x in ['jsxDEV', 'return', 'useState', 'useEffect']):
            out.write(f"=== COMPONENT: {name}({args}) ===\n")
            out.write(body[:3000] + "\n\n")

print("Components written to react_components_clean.txt")
