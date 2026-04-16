import json
import re

# Učitaj JSON
with open('data/stabla.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Regex za visinu: broj 1-9 iza kojeg "m"
pattern = re.compile(r'\b([1-9])m\b')

count = 0
for item in data['items']:
    notes = item.get('napomena', '')
    # Ako nema visine ili je null/empty string, parsira iz napomena
    if not item.get('visina_m'):
        match = pattern.search(notes)
        if match:
            height = int(match.group(1))
            item['visina_m'] = height
            print(f"Dodano visina_m: {height} za {item['id']} iz '{notes}'")
            count += 1

# Spremi JSON sa proper formatiranjem
with open('data/stabla.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"Gotovo! Dodano {count} visina.")