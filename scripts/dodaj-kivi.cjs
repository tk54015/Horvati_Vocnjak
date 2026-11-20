// Jednokratno: dodaje vrstu "kivi" u aplikaciju, enciklopediju i raspored radova.
// Pokretanje (iz mape projekta): node scripts/dodaj-kivi.cjs
const fs = require('fs');

function patchText(path, reps) {
  let s = fs.readFileSync(path, 'utf8');
  const crlf = s.includes('\r\n');
  s = s.replace(/\r\n/g, '\n');
  for (const [a, b, count] of reps) {
    const n = s.split(a).length - 1;
    if (n !== (count || 1)) throw new Error(path + ': ' + n + 'x ' + JSON.stringify(a.slice(0, 60)));
    s = s.split(a).join(b);
  }
  fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
}

// ---------------------------------------------------------------- script.js
patchText('script.js', [
  // emoji mape (postoje dvije)
  [`        vinova_loza: '🍇',
        ostalo: '🌳'
    };`, `        vinova_loza: '🍇',
        kivi: '🥝',
        ostalo: '🌳'
    };`, 2],
  // prepoznavanje naziva (kivi / kiwi)
  [`    if (t.indexOf('jabuk') !== -1) return 'jabuka';`,
   `    if (t.indexOf('kivi') !== -1 || t.indexOf('kiwi') !== -1) return 'kivi';
    if (t.indexOf('jabuk') !== -1) return 'jabuka';`],
  // procjena uroda
  [`    dud2: 15,
`, `    dud2: 15,
    kivi: 30,
`],
  [`    vinova_loza: { adultHeightM: 2.0, minKg: 2, maxKg: 8 },
`, `    vinova_loza: { adultHeightM: 2.0, minKg: 2, maxKg: 8 },
    kivi: { adultHeightM: 2.5, minKg: 20, maxKg: 50 },
`],
  // voda
  [`    vinova_loza: 2,
    _default: 2`, `    vinova_loza: 2,
    kivi: 4,
    _default: 2`],
  // marker: emoji dok nema vlastite slike
  [`    if (normalizedType === 'ostalo') {
        // Ostalo (stablo, grm...): obični emoji stabla
        return L.divIcon({
            className: 'emoji-marker',
            html: '<span>🌳</span>',`, `    var markerEmoji = EMOJI_MARKERS[normalizedType];
    if (markerEmoji && !iconByType(item.treeType)) {
        // Vrste bez vlastite slike: emoji (Ostalo = stablo, Kivi = kivi)
        return L.divIcon({
            className: 'emoji-marker',
            html: '<span>' + markerEmoji + '</span>',`],
  [`var FULL_ICON_SIZE = 30;
`, `var FULL_ICON_SIZE = 30;
// Vrste koje se na karti prikazuju emojijem dok nemaju vlastitu sliku u icons/
var EMOJI_MARKERS = { ostalo: '🌳', kivi: '🥝' };
`],
]);

// ---------------------------------------------------------------- index.html
patchText('index.html', [
  [`            <option value="ostalo">Ostalo (stablo, grm…) 🌳</option>`,
   `            <option value="kivi">Kivi 🥝</option>
            <option value="ostalo">Ostalo (stablo, grm…) 🌳</option>`],
]);

// ---------------------------------------------------------- izvoz za provjeru
patchText('scripts/izvoz-za-provjeru.cjs', [
  [`vinova_loza: 2 };`, `vinova_loza: 2, kivi: 4 };`],
]);

// ------------------------------------------------------------- enciklopedija
const GLINA = ' Na glinastom tlu voda se dugo zadržava: prije zalijevanja provjeriti vlagu na 10–20 cm i ne prelijevati.';
const encPath = 'data/enciklopedija.json';
const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
if (enc.vrste.some(v => v.id === 'kivi')) throw new Error('kivi već postoji u enciklopediji');
const kivi = {
  id: 'kivi',
  naziv: 'Kivi',
  latinski: 'Actinidia deliciosa / Actinidia arguta',
  emoji: '🥝',
  opis: 'Bujna listopadna penjačica kojoj treba čvrsta konstrukcija (pergola ili T-nosači sa žicom). Većina sorti je dvodomna: za plodove trebaju ženske biljke i barem jedna muška kao oprašivač (orijentacijski 1 muška na 6–8 ženskih, u blizini); postoje i samooplodne sorte. Krupni kivi (A. deliciosa) osjetljiv je na kasne proljetne mrazeve (mladi izboji) i jake zimske mrazeve, pa traži toplo, zaštićeno mjesto. Mini kivi (A. arguta) puno je otporniji na hladnoću, a sitni plodovi jedu se s korom. Rod počinje obično 3–5 godina nakon sadnje.',
  voda: 'Visoka potreba ljeti: veliki listovi i plitko korijenje, pa u suši brzo vene. Malčirati i redovito zalijevati u ljetnim sušama, posebno mlade biljke. Istodobno ne podnosi zadržavanje vode oko korijena (trulež korijena).' + GLINA,
  orezivanje: {
    kada: 'Zimska rezidba u mirovanju (siječanj–veljača), prije kretanja sokova, jer kasnije jako curi sok. Ljetna rezidba lipanj–kolovoz. Muške biljke orezati odmah nakon cvatnje.',
    kako: 'Plodovi rastu na ovogodišnjim izbojima koji izbijaju iz prošlogodišnjeg drva. Zimi na kordonima ostaviti dobro razvijene jednogodišnje rodne izboje (orijentacijski skraćene na 8–12 pupova), a izboje koji su već rodili ukloniti ili zamijeniti novima. Ljeti rodne izboje prikratiti nekoliko listova iza zadnjeg ploda i uklanjati prebujne, isprepletene izboje da krošnja ostane prozračna.'
  },
  gnojidba: 'Voli tlo bogato organskom tvari, blago kiselo. Osnova je kompost ili zreli stajski gnoj u proljeće; mineralno gnojivo samo ako biljka slabo raste ili lišće žuti (na vapnenastom tlu moguća je kloroza).',
  bolesti: [
    { naziv: 'Bakterijski rak kivija', opis: 'Smeđe pjege sa žutim rubom na listu, sušenje izboja i cvjetova, a na kori rane iz kojih curi crvenkasti ili bjelkasti iscjedak. Ozbiljna bolest: sumnju prijaviti savjetodavnoj službi, zaražene dijelove izrezati po suhom vremenu i dezinficirati alat.' },
    { naziv: 'Trulež korijena', opis: 'Biljka vene i žuti unatoč vlažnom tlu. Nastaje na teškom, mokrom tlu bez odvodnje; sprječava se sadnjom na ocjedito mjesto ili blago povišenu gredicu.' },
    { naziv: 'Siva plijesan', opis: 'Trulež cvjetova i plodova u kišnom vremenu i kasnije u skladištu. Pomaže prozračna krošnja i čuvanje samo zdravih plodova.' }
  ],
  stetnici: [
    { naziv: 'Mramorasta stjenica', opis: 'Sisanjem oštećuje plodove (udubljenja i plutasta mjesta ispod kore). Pratiti od ljeta, ručno uklanjati.' },
    { naziv: 'Štitaste uši', opis: 'Povremeno na granama; manje kolonije ostrugati.' },
    { naziv: 'Mačke', opis: 'Mlade biljke kivija privlače mačke koje grizu i grebu izboje i koru; mlade sadnice zaštititi mrežom.' }
  ],
  zastita: [
    { kada: 'Mirovanje', sto: 'Zimska rezidba; pregledati koru na rane i iscjedak (bakterijski rak), alat dezinficirati.' },
    { kada: 'Kretanje vegetacije (travanj–svibanj)', sto: 'Mlade izboje zaštititi agrotekstilom kad je najavljen kasni mraz.' },
    { kada: 'Proljeće', sto: 'Bakreni tretman samo ako je bilo pjega i rak-rana od bakterijskog raka.' },
    { kada: 'Ljeto', sto: 'Redovito zalijevanje u suši, ljetna rezidba, pregled plodova na stjenice.' },
    { kada: 'Kasna jesen', sto: 'Deblo mladih biljaka omotati (zaštita od mraza).' }
  ],
  berba: 'Krupni kivi: listopad–studeni, prije jačih mrazeva. Bere se još tvrd kad sjemenke potamne, a dozrijeva u skladištu (brže uz jabuke). Mini kivi: rujan–listopad, kad plodovi omekšaju, i jedu se odmah.'
};
const ostaloIdx = enc.vrste.findIndex(v => v.id === 'ostalo');
enc.vrste.splice(ostaloIdx === -1 ? enc.vrste.length : ostaloIdx, 0, kivi);
fs.writeFileSync(encPath, JSON.stringify(enc, null, 2) + '\n');

// ----------------------------------------------------------------- raspored
const rasPath = 'data/raspored.json';
const ras = JSON.parse(fs.readFileSync(rasPath, 'utf8'));
if (ras.zadaci.some(z => z.id.startsWith('kivi-'))) throw new Error('kivi zadaci već postoje');
const zal = ras.zadaci.find(z => z.id === 'zalijevanje');
zal.opis = zal.opis.replace('Prioritet: mlada stabla (prve 2–3 godine) i breskve.', 'Prioritet: mlada stabla (prve 2–3 godine), breskve i kivi.');
ras.zadaci.push(
  { id: 'kivi-rez-zima', mjeseci: [1, 2], prioritet: 2, kategorija: 'orezivanje', vrste: ['kivi'], naslov: 'Zimska rezidba kivija', opis: 'U mirovanju, prije kretanja sokova (kasnije jako curi sok). Ostaviti dobro razvijene jednogodišnje rodne izboje, a one koji su rodili ukloniti ili zamijeniti.' },
  { id: 'kivi-mraz', mjeseci: [4, 5], prioritet: 2, kategorija: 'vrijeme', vrste: ['kivi'], poPotrebi: true, naslov: 'Zaštititi mlade izboje kivija od kasnog mraza', opis: 'Mladi izboji stradaju već na blagom mrazu. Kad je najavljen mraz, prekriti ih agrotekstilom preko noći.' },
  { id: 'kivi-ljetna', mjeseci: [6, 7, 8], prioritet: 2, kategorija: 'orezivanje', vrste: ['kivi'], naslov: 'Ljetna rezidba kivija', opis: 'Rodne izboje prikratiti nekoliko listova iza zadnjeg ploda, ukloniti prebujne i isprepletene izboje, nove izboje vezati na konstrukciju. Muške biljke orezati nakon cvatnje.' },
  { id: 'kivi-berba', mjeseci: [10, 11], prioritet: 1, kategorija: 'berba', vrste: ['kivi'], naslov: 'Berba kivija', opis: 'Prije jačih mrazeva. Krupni kivi brati tvrd kad sjemenke potamne, pa ostaviti da dozrije u skladištu; mini kivi kad omekša.' },
  { id: 'kivi-zima', mjeseci: [11, 12], prioritet: 3, kategorija: 'ostalo', vrste: ['kivi'], naslov: 'Zimska zaštita mladog kivija', opis: 'Prve 2–3 godine deblo omotati (juta, agrotekstil) i malčirati bazu.' }
);
let rasOut = JSON.stringify(ras, null, 2);
rasOut = rasOut.replace(/\{\n\s+"id": [\s\S]*?\n\s+\}(?=,?\n)/g, m => m.includes('"mjeseci"')
  ? m.replace(/\n\s*/g, ' ').replace(/\[ /g, '[').replace(/ \]/g, ']')
  : m);
fs.writeFileSync(rasPath, rasOut + '\n');

console.log('ok: kivi dodan');
