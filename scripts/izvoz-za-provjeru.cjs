// Izvoz enciklopedije i rasporeda radova u jedan čitljiv Markdown za provjeru.
// Pokretanje (iz mape projekta): node scripts/izvoz-za-provjeru.cjs . sadrzaj-za-provjeru.md
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const out = process.argv[3];
const enc = JSON.parse(fs.readFileSync(path.join(root, 'data/enciklopedija.json'), 'utf8'));
const ras = JSON.parse(fs.readFileSync(path.join(root, 'data/raspored.json'), 'utf8'));

const MONTHS = ['Siječanj', 'Veljača', 'Ožujak', 'Travanj', 'Svibanj', 'Lipanj', 'Srpanj', 'Kolovoz', 'Rujan', 'Listopad', 'Studeni', 'Prosinac'];
const WATER = { jabuka: 3, kruska: 3, breskva: 4, smokva: 1, kupina: 3, glog: 1, dunja: 2, sljiva: 3, tresnja: 3, visnja: 3, ribizl: 2, vinova_loza: 2, kivi: 4 };
const names = Object.fromEntries(enc.vrste.map(v => [v.id, v.naziv]));
const L = [];

L.push('# Horvati voćnjak – sadržaj za provjeru', '');
L.push('Ovo je sav stručni sadržaj aplikacije: **enciklopedija vrsta** i **raspored radova po mjesecima**.');
L.push('Voćnjak je hobi voćnjak u kontinentalnoj Hrvatskoj (okolica Zagreba), gnoji se uglavnom kompostom.', '');
L.push('## Prijedlog upute za provjeru', '');
L.push('> Provjeri stručnu točnost ovog sadržaja za hobi voćnjak u kontinentalnoj Hrvatskoj (okolica Zagreba). ' +
  'Za svaku vrstu i svaki zadatak navedi: (1) što je netočno ili zastarjelo, (2) što važno nedostaje, ' +
  '(3) jesu li rokovi (mjeseci) i prioriteti realni. Odgovori po vrstama i po ID-u zadatka, kratko i konkretno. ' +
  'Ne predlaži komercijalne nazive sredstava, samo vrstu pripravka (npr. bakreni, sumporni, uljni).', '');
L.push('---', '');

L.push('# Dio 1 – Enciklopedija vrsta', '');
L.push('_' + enc.meta.napomena + '_', '');
enc.vrste.forEach(v => {
  L.push(`## ${v.naziv}${v.latinski ? ` (*${v.latinski}*)` : ''}`, '', `**ID:** \`${v.id}\``, '', v.opis, '');
  const w = WATER[v.id] !== undefined ? WATER[v.id] : 2;
  L.push(`**Voda** (razina ${w}/4 u aplikaciji): ${v.voda}`, '');
  if (v.orezivanje) L.push(`**Orezivanje – kada:** ${v.orezivanje.kada}`, '', `**Orezivanje – kako:** ${v.orezivanje.kako}`, '');
  if (v.gnojidba) L.push(`**Gnojidba:** ${v.gnojidba}`, '');
  if (v.bolesti && v.bolesti.length) { L.push('**Bolesti:**'); v.bolesti.forEach(b => L.push(`- **${b.naziv}** – ${b.opis}`)); L.push(''); }
  if (v.stetnici && v.stetnici.length) { L.push('**Štetnici:**'); v.stetnici.forEach(b => L.push(`- **${b.naziv}** – ${b.opis}`)); L.push(''); }
  if (v.zastita && v.zastita.length) {
    L.push('**Zaštita kroz godinu:**', '', '| Kada | Što |', '|---|---|');
    v.zastita.forEach(z => L.push(`| ${z.kada} | ${z.sto} |`));
    L.push('');
  }
  if (v.berba) L.push(`**Berba:** ${v.berba}`, '');
});

L.push('---', '', '# Dio 2 – Raspored radova', '');
L.push('_' + ras.meta.napomena + '_', '');
L.push('Prioriteti: ' + Object.entries(ras.meta.prioriteti).map(([k, p]) => `${p.oznaka} ${k} = ${p.naziv} (${p.opis})`).join('; ') + '.', '');
L.push('Aplikacija za svaki mjesec prikazuje zadatke kojima je taj mjesec u popisu mjeseci, samo za vrste koje su posađene.', '');

L.push('## Svi zadaci', '', '| ID | Prioritet | Mjeseci | Kategorija | Vrste | Zadatak | Opis |', '|---|---|---|---|---|---|---|');
ras.zadaci.forEach(z => {
  const p = ras.meta.prioriteti[String(z.prioritet)];
  L.push(`| \`${z.id}\` | ${p.oznaka} ${p.naziv} | ${z.mjeseci.map(m => MONTHS[m - 1].slice(0, 3)).join(', ')} | ${z.kategorija} | ${z.vrste.length ? z.vrste.map(v => names[v] || v).join(', ') : 'sve'} | ${z.naslov} | ${(z.opis || '').replace(/\|/g, '/')} |`);
});
L.push('');

L.push('## Pregled po mjesecima', '');
for (let m = 1; m <= 12; m++) {
  L.push(`### ${MONTHS[m - 1]}`, '');
  ras.zadaci.filter(z => z.mjeseci.includes(m)).sort((a, b) => a.prioritet - b.prioritet).forEach(z => {
    const p = ras.meta.prioriteti[String(z.prioritet)];
    L.push(`- ${p.oznaka} ${z.naslov} – ${z.vrste.length ? z.vrste.map(v => names[v] || v).join(', ') : 'sve'} (\`${z.id}\`)`);
  });
  L.push('');
}

fs.writeFileSync(out, L.join('\n'));
console.log('ok', out, L.length, 'redova');
