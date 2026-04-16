import json
import re

# Učitaj JSON
with open('data/stabla.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Regex za visinu: broj 1-9 iza kojeg "m"
pattern = re.compile(r'\b([1-9])m\b')

for item in data['items']:
    notes = item.get('napomena', '')
    match = pattern.search(notes)
    if match and not item.get('visina_m'):  # Ako već nema visinu
        height = int(match.group(1))
        item['visina_m'] = height
        print(f"Dodano visina_m: {height} za {item['id']}")

# Spremi JSON
with open('data/stabla.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=4, ensure_ascii=False)

print("Gotovo!")