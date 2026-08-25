import re

with open('bundle.js', 'r', encoding='utf-8', errors='ignore') as f:
    code = f.read()

# Search for CSS style strings injected by css-loader / style-loader
# In webpack, css modules or style loaders often have strings like:
# "body { ... }" or css rules
css_matches = re.findall(r'(\.[\w\-]+[\s\S]{10,2000}?\{[\s\S]{10,2000}?\})', code)
print(f"Found {len(css_matches)} potential CSS blocks.")

with open('extracted_styles.css', 'w', encoding='utf-8') as out:
    for m in css_matches[:100]:
        out.write(m + "\n\n")

# Let's search for whole CSS strings in webpack css-loader output
css_full = re.findall(r'\"((?:\\.|\/\\*[\s\S]*?\\*\/|[^\"])*?\.fleet-chip[\s\S]*?)\"', code)
if css_full:
    print("Found exact CSS block containing .fleet-chip!")
    with open('extracted_styles.css', 'w', encoding='utf-8') as out:
        out.write(css_full[0].encode().decode('unicode_escape', 'ignore'))
else:
    # let's search for snippets around .fleet-chip
    idx = code.find('.fleet-chip')
    if idx != -1:
        print("Found .fleet-chip in bundle at index", idx)
        snippet = code[max(0, idx-500):min(len(code), idx+40000)]
        with open('extracted_styles.css', 'w', encoding='utf-8') as out:
            out.write(snippet)

print("Finished style extraction.")
